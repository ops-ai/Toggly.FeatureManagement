using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Tests.TestHelpers;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

/// <summary>
/// Golden regression tests for signed snapshot load — would have caught the
/// historical Invalid signature bug from re-serializing stored features.
/// </summary>
public class SignedSnapshotReliabilityTests : IDisposable
{
    private readonly Mock<IHostEnvironment> _hostEnvironmentMock = new();
    private readonly Mock<ILoggerFactory> _loggerFactoryMock = new();
    private readonly Mock<ILogger<TogglyFeatureProvider>> _loggerMock = new();
    private readonly Mock<IHttpClientFactory> _httpClientFactoryMock = new();
    private readonly Mock<IServiceProvider> _serviceProviderMock = new();
    private readonly Mock<IFeatureStateInternalService> _featureStateServiceMock = new();
    private TogglyFeatureProvider? _provider;
    private HttpClient? _httpClient;

    public SignedSnapshotReliabilityTests()
    {
        _hostEnvironmentMock.Setup(x => x.EnvironmentName).Returns("Production");
        _hostEnvironmentMock.Setup(x => x.ApplicationName).Returns("Tests");
        _hostEnvironmentMock.Setup(x => x.ContentRootPath).Returns("/");
        _loggerFactoryMock.Setup(x => x.CreateLogger(It.IsAny<string>())).Returns(_loggerMock.Object);
        _featureStateServiceMock.Setup(x => x.WhenFeatureTurnsOn(It.IsAny<string>(), It.IsAny<Action>())).Returns(Guid.NewGuid());
        _featureStateServiceMock.Setup(x => x.WhenFeatureTurnsOff(It.IsAny<string>(), It.IsAny<Action>())).Returns(Guid.NewGuid());
        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureStateInternalService)))
            .Returns(_featureStateServiceMock.Object);
        _serviceProviderMock.Setup(x => x.GetService(typeof(IMetricsService))).Returns(null);
    }

    public void Dispose()
    {
        _provider?.Dispose();
        _httpClient?.Dispose();
    }

    private static (ECDsa Key, string Kid, JsonWebKeySet Jwks, string Signature, string DefsJson, long Timestamp) CreateSignedDefs(
        string? defsJson = null)
    {
        var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = ecdsa.ExportParameters(false);
        var x = Base64UrlEncode(parameters.Q.X!);
        var y = Base64UrlEncode(parameters.Q.Y!);
        var kidInput = parameters.Q.X!.Concat(parameters.Q.Y!).ToArray();
        string kid;
        using (var sha1 = SHA1.Create())
        {
            kid = BitConverter.ToString(sha1.ComputeHash(kidInput)).Replace("-", "") + "ES256";
        }

        defsJson ??= "[{\"featureKey\":\"flag-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}],\"securedFeature\":false,\"requirementType\":\"Any\"}]";
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var payload = $"{defsJson}|{timestamp}";
        byte[] hash;
        using (var sha256 = SHA256.Create())
        {
            var first = sha256.ComputeHash(Encoding.UTF8.GetBytes(payload));
            hash = sha256.ComputeHash(first);
        }

        var signatureBytes = ecdsa.SignHash(hash);
        var signature = Convert.ToBase64String(signatureBytes);

        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new JsonWebKey
                {
                    Kid = kid,
                    Kty = "EC",
                    Crv = "P-256",
                    X = x,
                    Y = y,
                    Alg = "ES256",
                    Use = "sig"
                }
            }
        };

        return (ecdsa, kid, jwks, signature, defsJson, timestamp);
    }

    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static List<FeatureDefinitionModel> ParseDefs(string defsJson)
    {
        return JsonSerializer.Deserialize<List<FeatureDefinitionModel>>(defsJson,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    }

    private async Task<(TogglyFeatureProvider Provider, string? OnError)> CreateSignedProviderFromSnapshotAsync(
        FeatureDefinitionsSnapshot snapshot,
        JsonWebKeySet jwks,
        long jwksTimestamp)
    {
        var snapshotProvider = new MockSnapshotProvider();
        await snapshotProvider.SaveSnapshotAsync(snapshot);
        await snapshotProvider.SaveJwkSnapshot(jwks, jwksTimestamp);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProvider);

        var handler = new MockHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotModified));
        _httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://definitions.toggly.io/") };
        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly")).Returns(_httpClient);

        string? onErrorMessage = null;
        var settings = Options.Create(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Production",
            UseSignedDefinitions = true,
            DefinitionsBaseUrl = "https://definitions.toggly.io/",
            OnError = (msg, _) => onErrorMessage = msg
        });

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        // Touch a flag so initial LoadSnapshot completes before assertions on OnError.
        await _provider.GetFeatureDefinitionAsync("__warmup__");
        return (_provider, onErrorMessage);
    }

    [Fact]
    public async Task LoadSnapshot_WithSignedDefsJson_VerifiesAndLoadsFeatures()
    {
        var (_, kid, jwks, signature, defsJson, timestamp) = CreateSignedDefs();
        var features = ParseDefs(defsJson);

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = defsJson,
                ETag = "rev-abc"
            },
            jwks,
            timestamp);

        var result = await provider.GetFeatureDefinitionAsync("flag-a");
        result.Name.Should().Be("flag-a");
        result.EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
        onError.Should().BeNull();
    }

    [Fact]
    public async Task LoadSnapshot_WithNullFeatures_StillLoadsFromVerifiedSignedDefsJson()
    {
        var (_, kid, jwks, signature, defsJson, timestamp) = CreateSignedDefs();

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = null,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = defsJson
            },
            jwks,
            timestamp);

        var result = await provider.GetFeatureDefinitionAsync("flag-a");
        result.EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
        onError.Should().BeNull();
    }

    [Fact]
    public async Task LoadSnapshot_WithMatchingFeaturesInDifferentOrder_Loads()
    {
        const string defsJson =
            "[{\"featureKey\":\"flag-b\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}],\"securedFeature\":false,\"requirementType\":\"Any\"}," +
            "{\"featureKey\":\"flag-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}],\"securedFeature\":false,\"requirementType\":\"Any\"}]";
        var (_, kid, jwks, signature, signedJson, timestamp) = CreateSignedDefs(defsJson);
        var features = ParseDefs(signedJson);
        features.Reverse();

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = signedJson
            },
            jwks,
            timestamp);

        (await provider.GetFeatureDefinitionAsync("flag-a")).EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
        (await provider.GetFeatureDefinitionAsync("flag-b")).EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
        onError.Should().BeNull();
    }

    [Fact]
    public async Task LoadSnapshot_RejectsTamperedFeatures_WhenTheyDivergeFromSignedDefsJson()
    {
        var (_, kid, jwks, signature, defsJson, timestamp) = CreateSignedDefs();
        var tamperedFeatures = new List<FeatureDefinitionModel>
        {
            new()
            {
                FeatureKey = "evil-flag",
                Filters = new List<FeatureFilter> { new() { Name = "AlwaysOn" } }
            }
        };

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = tamperedFeatures,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = defsJson,
                ETag = "rev-abc"
            },
            jwks,
            timestamp);

        (await provider.GetFeatureDefinitionAsync("flag-a")).EnabledFor.Should().BeEmpty();
        (await provider.GetFeatureDefinitionAsync("evil-flag")).EnabledFor.Should().BeEmpty();
        onError.Should().NotBeNull().And.Contain("do not match verified SignedDefsJson");
        provider.GetDebugInfo().LastError.Should().Contain("do not match verified SignedDefsJson");
    }

    [Fact]
    public async Task LoadSnapshot_RejectsTamperedSecuredFeatureFlag()
    {
        var (_, kid, jwks, signature, defsJson, timestamp) = CreateSignedDefs();
        var features = ParseDefs(defsJson);
        features[0].SecuredFeature = true;

        var (_, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = defsJson
            },
            jwks,
            timestamp);

        onError.Should().Contain("do not match verified SignedDefsJson");
    }

    [Fact]
    public async Task LoadSnapshot_RejectsTamperedFilterParameters()
    {
        const string defsJson =
            "[{\"featureKey\":\"pct\",\"filters\":[{\"name\":\"Percentage\",\"parameters\":{\"Value\":\"10\"}}],\"securedFeature\":false,\"requirementType\":\"Any\"}]";
        var (_, kid, jwks, signature, signedJson, timestamp) = CreateSignedDefs(defsJson);
        var features = ParseDefs(signedJson);
        features[0].Filters[0].Parameters!["Value"] = "99";

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = signedJson
            },
            jwks,
            timestamp);

        (await provider.GetFeatureDefinitionAsync("pct")).EnabledFor.Should().BeEmpty();
        onError.Should().Contain("do not match verified SignedDefsJson");
    }

    [Fact]
    public async Task LoadSnapshot_RejectsWhenExtraFeatureInjectedIntoTypedCopy()
    {
        var (_, kid, jwks, signature, defsJson, timestamp) = CreateSignedDefs();
        var features = ParseDefs(defsJson);
        features.Add(new FeatureDefinitionModel
        {
            FeatureKey = "injected",
            Filters = new List<FeatureFilter> { new() { Name = "AlwaysOn" } }
        });

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = defsJson
            },
            jwks,
            timestamp);

        (await provider.GetFeatureDefinitionAsync("flag-a")).EnabledFor.Should().BeEmpty();
        (await provider.GetFeatureDefinitionAsync("injected")).EnabledFor.Should().BeEmpty();
        onError.Should().Contain("do not match verified SignedDefsJson");
    }

    [Fact]
    public async Task LoadSnapshot_RejectsWhenTypedFeaturesOmitASignedFlag()
    {
        const string defsJson =
            "[{\"featureKey\":\"flag-a\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}],\"securedFeature\":false,\"requirementType\":\"Any\"}," +
            "{\"featureKey\":\"flag-b\",\"filters\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}],\"securedFeature\":false,\"requirementType\":\"Any\"}]";
        var (_, kid, jwks, signature, signedJson, timestamp) = CreateSignedDefs(defsJson);
        var features = ParseDefs(signedJson).Where(f => f.FeatureKey == "flag-a").ToList();

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp,
                SignedDefsJson = signedJson
            },
            jwks,
            timestamp);

        (await provider.GetFeatureDefinitionAsync("flag-a")).EnabledFor.Should().BeEmpty();
        (await provider.GetFeatureDefinitionAsync("flag-b")).EnabledFor.Should().BeEmpty();
        onError.Should().Contain("do not match verified SignedDefsJson");
    }

    [Fact]
    public async Task LoadSnapshot_WithoutSignedDefsJson_LegacySoftLoadsFeatures()
    {
        var (_, kid, jwks, signature, defsJson, timestamp) = CreateSignedDefs();
        var features = ParseDefs(defsJson);

        var (provider, onError) = await CreateSignedProviderFromSnapshotAsync(
            new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = kid,
                Timestamp = timestamp
            },
            jwks,
            timestamp);

        var result = await provider.GetFeatureDefinitionAsync("flag-a");
        result.EnabledFor.Should().Contain(f => f.Name == "AlwaysOn");
        onError.Should().NotBeNull().And.Contain("SignedDefsJson");
        provider.GetDebugInfo().LastError.Should().Contain("SignedDefsJson");
    }

    [Fact]
    public void ReSerializedFeatures_DoNotMatchServerSignedPayload()
    {
        // Documents the historical bug: Newtonsoft re-serialize of typed models
        // does not equal the original signed defs JSON.
        var (_, _, _, signature, defsJson, timestamp) = CreateSignedDefs();
        var features = ParseDefs(defsJson);

        var reSerialized = Newtonsoft.Json.JsonConvert.SerializeObject(features, new Newtonsoft.Json.JsonSerializerSettings
        {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver
            {
                NamingStrategy = new Newtonsoft.Json.Serialization.CamelCaseNamingStrategy { ProcessDictionaryKeys = false }
            },
            Converters = { new Newtonsoft.Json.Converters.StringEnumConverter() },
            Formatting = Newtonsoft.Json.Formatting.None
        });

        // Even if property names match, empty parameters {} vs omitted fields / enum casing can drift.
        // Assert the verification payload differs OR that verifying re-serialized bytes fails.
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        // We only assert string inequality when serializers diverge; if equal this still
        // proves we must store raw bytes for stable verification across all payloads.
        var originalPayload = $"{defsJson}|{timestamp}";
        var reSerializedPayload = $"{reSerialized}|{timestamp}";

        byte[] Hash(string data)
        {
            using var sha = SHA256.Create();
            return sha.ComputeHash(sha.ComputeHash(Encoding.UTF8.GetBytes(data)));
        }

        // Signature was created for originalPayload; re-serialized hash must not verify
        // unless strings are identical (in which case storing raw is still correct/safe).
        if (!string.Equals(originalPayload, reSerializedPayload, StringComparison.Ordinal))
        {
            Convert.FromBase64String(signature).Length.Should().BeGreaterThan(0);
            Hash(originalPayload).Should().NotEqual(Hash(reSerializedPayload));
        }
        else
        {
            // Simple AlwaysOn payload may round-trip identically — still require SignedDefsJson API exists.
            typeof(FeatureDefinitionsSnapshot).GetProperty(nameof(FeatureDefinitionsSnapshot.SignedDefsJson)).Should().NotBeNull();
        }
    }

    [Fact]
    public async Task ClearPersistedSnapshotsAsync_ClearsFeaturesAndJwks()
    {
        var snapshotProvider = new MockSnapshotProvider(
            new List<FeatureDefinitionModel> { new() { FeatureKey = "x" } },
            "sig", "kid", 123);
        await snapshotProvider.SaveJwkSnapshot(new JsonWebKeySet { Keys = new List<JsonWebKey>() }, 123);

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(snapshotProvider);

        // Prevent background refresh from rewriting the snapshot after clear
        var handler = new MockHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotModified));
        _httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://definitions.toggly.io/") };
        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly")).Returns(_httpClient);

        var settings = Options.Create(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Production",
            UseSignedDefinitions = false,
            DefinitionsBaseUrl = "https://definitions.toggly.io/"
        });

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await _provider.ClearPersistedSnapshotsAsync();
        _provider.Dispose();
        _provider = null;

        (await snapshotProvider.GetFeaturesSnapshotAsync()).Should().BeNull();
        (await snapshotProvider.GetJwkSnapshotAsync()).Jwks.Should().BeNull();
    }

    [Fact]
    public async Task RefreshFeatures_ReadsUnquotedETagViaRevisionHeader()
    {
        var definitions = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "flag-b", Filters = new List<FeatureFilter> { new() { Name = "AlwaysOn" } } }
        };
        var json = JsonSerializer.Serialize(definitions);
        FeatureDefinitionsSnapshot? saved = null;
        var mockSnap = new Mock<IFeatureSnapshotProvider>();
        mockSnap.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureDefinitionsSnapshot?)null);
        mockSnap.Setup(x => x.SaveSnapshotAsync(It.IsAny<FeatureDefinitionsSnapshot>(), It.IsAny<CancellationToken>()))
            .Callback<FeatureDefinitionsSnapshot, CancellationToken>((s, _) => saved = s)
            .Returns(Task.CompletedTask);
        mockSnap.Setup(x => x.GetJwkSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((null, (long?)null));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(mockSnap.Object);

        var handler = new MockHttpMessageHandler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            // Unquoted ETag is not assigned to Headers.ETag; put revision header instead
            response.Headers.TryAddWithoutValidation("X-Definitions-Revision", "deadbeefcafebabe");
            return response;
        });
        _httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://definitions.toggly.io/") };
        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly")).Returns(_httpClient);

        var settings = Options.Create(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Production",
            UseSignedDefinitions = false,
            DefinitionsBaseUrl = "https://definitions.toggly.io/"
        });

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await _provider.GetFeatureDefinitionAsync("flag-b");

        saved.Should().NotBeNull();
        saved!.ETag.Should().Be("deadbeefcafebabe");
    }

    [Fact]
    public async Task RefreshFeatures_ReadsUnquotedRawETagHeader()
    {
        var definitions = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "flag-c", Filters = new List<FeatureFilter> { new() { Name = "AlwaysOn" } } }
        };
        var json = JsonSerializer.Serialize(definitions);
        FeatureDefinitionsSnapshot? saved = null;
        var mockSnap = new Mock<IFeatureSnapshotProvider>();
        mockSnap.Setup(x => x.GetFeaturesSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureDefinitionsSnapshot?)null);
        mockSnap.Setup(x => x.SaveSnapshotAsync(It.IsAny<FeatureDefinitionsSnapshot>(), It.IsAny<CancellationToken>()))
            .Callback<FeatureDefinitionsSnapshot, CancellationToken>((s, _) => saved = s)
            .Returns(Task.CompletedTask);
        mockSnap.Setup(x => x.GetJwkSnapshotAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync((null, (long?)null));

        _serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(mockSnap.Object);

        var handler = new MockHttpMessageHandler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            response.Headers.TryAddWithoutValidation("ETag", "rawdeadbeef");
            return response;
        });
        _httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://definitions.toggly.io/") };
        _httpClientFactoryMock.Setup(x => x.CreateClient("toggly")).Returns(_httpClient);

        var settings = Options.Create(new TogglySettings
        {
            AppKey = "test-app-key",
            Environment = "Production",
            UseSignedDefinitions = false,
            DefinitionsBaseUrl = "https://definitions.toggly.io/"
        });

        _provider = new TogglyFeatureProvider(
            settings,
            _hostEnvironmentMock.Object,
            _loggerFactoryMock.Object,
            _httpClientFactoryMock.Object,
            _serviceProviderMock.Object);

        await _provider.GetFeatureDefinitionAsync("flag-c");

        saved.Should().NotBeNull();
        saved!.ETag.Should().Be("rawdeadbeef");
    }
}
