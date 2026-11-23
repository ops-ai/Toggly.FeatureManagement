#nullable enable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Moq;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Filters;
using Toggly.FeatureManagement.Web.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Parity.Tests;

/// <summary>
/// Contract tests: shared filter-parity / variant-allocator fixtures are served as Toggly
/// <c>definitions/{app}/{env}</c> JSON through a mocked <see cref="HttpMessageHandler"/>, then
/// evaluated via the public <see cref="IFeatureManager"/> / <see cref="IVariantFeatureManager"/>
/// APIs after <see cref="TogglyFeatureProvider"/> loads them. HTTP transport is mocked; evaluation is real.
/// Runs on every TFM declared by this test project.
/// </summary>
public class DefinitionsApiContractTests : IDisposable
{
    private const string AppKey = "contract-app";
    private const string EnvironmentName = "Production";
    private const string DefinitionsBaseUrl = "https://definitions.contract.test/";

    public DefinitionsApiContractTests()
    {
        TogglyFeatureProvider.WebSocketClientFactoryOverride = _ =>
            throw new InvalidOperationException("WebSocket disabled in contract tests");
    }

    public void Dispose()
    {
        TogglyFeatureProvider.WebSocketClientFactoryOverride = null;
        GC.SuppressFinalize(this);
    }

    public static TheoryData<string, string> FilterParityCases()
    {
        var data = new TheoryData<string, string>();
        var dir = SharedFixturePaths.ResolveFilterParityFixturesDir();
        foreach (var path in Directory.EnumerateFiles(dir, "*.json").OrderBy(p => p, StringComparer.Ordinal))
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var id = document.RootElement.GetProperty("id").GetString() ?? Path.GetFileNameWithoutExtension(path);
            data.Add(id, path);
        }

        return data;
    }

    public static TheoryData<string, string> VariantCorpusCases()
    {
        var data = new TheoryData<string, string>();
        var path = SharedFixturePaths.ResolveVariantAllocatorCorpusPath();
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var caseNode in document.RootElement.EnumerateArray())
        {
            var id = caseNode.GetProperty("id").GetString() ?? "unknown";
            data.Add(id, caseNode.GetRawText());
        }

        return data;
    }

    [Fact]
    public void SharedFixturesArePresent()
    {
        Directory.Exists(SharedFixturePaths.ResolveFilterParityFixturesDir())
            .Should().BeTrue("docs/filter-parity/fixtures must be present");
        File.Exists(SharedFixturePaths.ResolveVariantAllocatorCorpusPath())
            .Should().BeTrue("variant-allocator-corpus/cases.json must be present");
    }

    [Theory]
    [MemberData(nameof(FilterParityCases))]
    public async Task FilterParityFixture_LoadsViaDefinitionsHttp_AndEvaluatesIsEnabledAsync(
        string fixtureId, string fixturePath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(fixturePath));
        var root = document.RootElement;
        var description = root.TryGetProperty("description", out var desc) ? desc.GetString() : fixtureId;
        var expectation = ResolveDotNetExpectation(root);

        var definitionsJson = BuildDefinitionsPayloadFromFilterParityFixture(root);
        using var harness = await CreateHarnessAsync(definitionsJson);
        var (result, error) = await EvaluateFilterParityAsync(harness, root);

        if (expectation.ExpectError)
        {
            error.Should().NotBeNull(
                "fixture {0} ({1}): sdkExpectations.dotnet.outcome=error requires evaluation to throw",
                fixtureId, description);
            return;
        }

        error.Should().BeNull(
            "fixture {0} ({1}) threw {2}: {3}",
            fixtureId, description, error?.GetType().Name, error?.Message);

        if (expectation.AllowedOutcomes is { Length: > 0 } allowed)
        {
            allowed.Should().Contain(result!.Value,
                "fixture {0}: {1} (allowed outcomes [{2}])",
                fixtureId, description, string.Join(", ", allowed));
            return;
        }

        result.Should().Be(expectation.ExpectedBoolean, "fixture {0}: {1}", fixtureId, description);
    }

    [Theory]
    [MemberData(nameof(VariantCorpusCases))]
    public async Task VariantCorpusCase_LoadsViaDefinitionsHttp_AndEvaluatesGetVariantAsync(
        string caseId, string caseJson)
    {
        using var document = JsonDocument.Parse(caseJson);
        var root = document.RootElement;
        var feature = root.GetProperty("feature");
        var targeting = root.GetProperty("targeting");
        var expected = root.GetProperty("expected");
        var ignoreCase = root.TryGetProperty("ignoreCase", out var ignoreCaseNode)
            && ignoreCaseNode.ValueKind == JsonValueKind.True;

        var definitionsJson = BuildDefinitionsPayloadFromVariantCorpusFeature(feature);
        using var harness = await CreateHarnessAsync(definitionsJson, ignoreCase: ignoreCase);

        var featureName = feature.GetProperty("name").GetString()
            ?? throw new InvalidOperationException("feature.name required");
        var targetingContext = new TargetingContext
        {
            UserId = targeting.TryGetProperty("userId", out var userId) && userId.ValueKind == JsonValueKind.String
                ? userId.GetString()
                : null,
            Groups = targeting.TryGetProperty("groups", out var groups) && groups.ValueKind == JsonValueKind.Array
                ? groups.EnumerateArray().Where(g => g.ValueKind == JsonValueKind.String).Select(g => g.GetString()!).ToList()
                : new List<string>()
        };

        var variantManager = harness.Services.GetRequiredService<IVariantFeatureManager>();
        var variant = await variantManager.GetVariantAsync(featureName, targetingContext);

        var expectedVariantName = expected.TryGetProperty("variantName", out var vn) && vn.ValueKind == JsonValueKind.String
            ? vn.GetString()
            : null;
        (variant?.Name).Should().Be(expectedVariantName, "case {0}: variantName via public API after HTTP load", caseId);

        if (expected.TryGetProperty("configurationValue", out var expectedConfig)
            && expectedConfig.ValueKind != JsonValueKind.Null)
        {
            variant.Should().NotBeNull("case {0}: expected configurationValue requires a variant", caseId);
            var actualConfig = ConfigSectionToJsonNode(variant!.Configuration);
            JsonNode.DeepEquals(actualConfig, JsonNode.Parse(expectedConfig.GetRawText()))
                .Should().BeTrue(
                    "case {0}: configurationValue mismatch. expected={1} actual={2}",
                    caseId, expectedConfig.GetRawText(), actualConfig?.ToJsonString());
        }
        else if (expectedVariantName == null)
        {
            variant.Should().BeNull("case {0}: expected no variant", caseId);
        }
    }

    private static async Task<(bool? Result, Exception? Error)> EvaluateFilterParityAsync(
        ContractHarness harness, JsonElement root)
    {
        try
        {
            var featureKey = root.GetProperty("featureKey").GetString()
                ?? throw new InvalidOperationException("fixture missing featureKey");

            // HttpContextAccessor stores HttpContext in AsyncLocal; re-bind in this
            // async frame so Web filters see the request built for the fixture.
            harness.HttpAccessor.HttpContext = harness.HttpContext;
            ApplyHttpContext(harness.HttpContext, root);
            ApplyTargeting(harness.TargetingAccessor, root);

            var manager = harness.Services.GetRequiredService<IFeatureManager>();
            var enabled = await manager.IsEnabledAsync(featureKey);
            return (enabled, null);
        }
        catch (Exception ex)
        {
            return (null, ex);
        }
    }

    private static void ApplyHttpContext(DefaultHttpContext httpContext, JsonElement root)
    {
        var requestCountry = TryGetString(root, "context", "request", "country");
        var userAgent = TryGetString(root, "context", "request", "userAgent");
        var acceptLanguage = TryGetString(root, "context", "request", "acceptLanguage");
        var httpHeaders = TryGetStringMap(root, "httpHeaders");
        var claims = TryGetStringMap(root, "context", "claims");

        if (!string.IsNullOrEmpty(userAgent))
        {
#if NET6_0_OR_GREATER
            httpContext.Request.Headers.UserAgent = userAgent;
#else
            httpContext.Request.Headers["User-Agent"] = userAgent;
#endif
        }

        if (!string.IsNullOrEmpty(acceptLanguage))
        {
#if NET6_0_OR_GREATER
            httpContext.Request.Headers.AcceptLanguage = acceptLanguage;
#else
            httpContext.Request.Headers["Accept-Language"] = acceptLanguage;
#endif
        }

        if (!string.IsNullOrEmpty(requestCountry) && (httpHeaders == null || !httpHeaders.Keys.Any(k =>
                string.Equals(k, "cf-ipcountry", StringComparison.OrdinalIgnoreCase)
                || string.Equals(k, "x-vercel-ip-country", StringComparison.OrdinalIgnoreCase)
                || string.Equals(k, "cloudfront-viewer-country", StringComparison.OrdinalIgnoreCase))))
        {
            httpContext.Request.Headers["CF-IPCountry"] = requestCountry;
        }

        if (httpHeaders != null)
        {
            foreach (var header in httpHeaders)
                httpContext.Request.Headers[header.Key] = header.Value;
        }

        if (claims != null && claims.Count > 0)
        {
            var claimList = claims.Select(pair => new Claim(pair.Key, pair.Value)).ToList();
            httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(claimList, "contract"));
        }
    }

    private static void ApplyTargeting(Mock<ITargetingContextAccessor> targetingAccessor, JsonElement root)
    {
        var identity = TryGetString(root, "context", "identity");
        var groups = TryGetStringArray(root, "context", "groups");
        targetingAccessor.Setup(a => a.GetContextAsync()).ReturnsAsync(new TargetingContext
        {
            UserId = identity,
            Groups = groups ?? Array.Empty<string>()
        });
    }

    private static string BuildDefinitionsPayloadFromFilterParityFixture(JsonElement root)
    {
        var featureKey = root.GetProperty("featureKey").GetString()
            ?? throw new InvalidOperationException("fixture missing featureKey");
        var requirementType = "Any";
        if (root.TryGetProperty("requirementType", out var req) && req.ValueKind == JsonValueKind.String)
            requirementType = req.GetString() ?? "Any";

        var filters = new JsonArray();
        if (root.TryGetProperty("filters", out var filterArray) && filterArray.ValueKind == JsonValueKind.Array)
        {
            foreach (var filterNode in filterArray.EnumerateArray())
            {
                var name = filterNode.GetProperty("name").GetString() ?? string.Empty;
                var parameters = new JsonObject();
                if (filterNode.TryGetProperty("parameters", out var paramsNode) && paramsNode.ValueKind == JsonValueKind.Object)
                {
                    foreach (var property in paramsNode.EnumerateObject())
                        parameters[property.Name] = JsonElementToParameterString(property.Value);
                }

                filters.Add(new JsonObject
                {
                    ["name"] = name,
                    ["parameters"] = parameters
                });
            }
        }

        var definition = new JsonObject
        {
            ["featureKey"] = featureKey,
            ["requirementType"] = requirementType,
            ["filters"] = filters
        };
        return new JsonArray { definition }.ToJsonString();
    }

    private static string BuildDefinitionsPayloadFromVariantCorpusFeature(JsonElement feature)
    {
        var name = feature.GetProperty("name").GetString()
            ?? throw new InvalidOperationException("feature.name required");

        var filters = new JsonArray();
        if (feature.TryGetProperty("enabledFor", out var enabledFor) && enabledFor.ValueKind == JsonValueKind.Array)
        {
            foreach (var filter in enabledFor.EnumerateArray())
            {
                filters.Add(new JsonObject
                {
                    ["name"] = filter.GetProperty("name").GetString() ?? string.Empty
                });
            }
        }

        var definition = new JsonObject
        {
            ["featureKey"] = name,
            ["filters"] = filters
        };

        if (feature.TryGetProperty("variants", out var variants) && variants.ValueKind == JsonValueKind.Array)
            definition["variants"] = JsonNode.Parse(variants.GetRawText());

        if (feature.TryGetProperty("allocation", out var allocation) && allocation.ValueKind == JsonValueKind.Object)
            definition["allocation"] = JsonNode.Parse(allocation.GetRawText());

        return new JsonArray { definition }.ToJsonString();
    }

    private static async Task<ContractHarness> CreateHarnessAsync(string definitionsJson, bool ignoreCase = false)
    {
        var handler = new DefinitionsHttpHandler(definitionsJson);
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri(DefinitionsBaseUrl) };

        var httpClientFactory = new Mock<IHttpClientFactory>();
        httpClientFactory.Setup(f => f.CreateClient("toggly")).Returns(httpClient);

        var hostEnvironment = new Mock<IHostEnvironment>();
        hostEnvironment.Setup(e => e.EnvironmentName).Returns(EnvironmentName);

        var loggerFactory = new Mock<ILoggerFactory>();
        loggerFactory.Setup(f => f.CreateLogger(It.IsAny<string>())).Returns(new Mock<ILogger>().Object);

        var featureState = new Mock<IFeatureStateInternalService>();
        var metrics = new Mock<IMetricsService>();
        var serviceProvider = new Mock<IServiceProvider>();
        serviceProvider.Setup(x => x.GetService(typeof(IFeatureSnapshotProvider)))
            .Returns(null!);
        serviceProvider.Setup(x => x.GetService(typeof(IFeatureStateInternalService)))
            .Returns(featureState.Object);
        serviceProvider.Setup(x => x.GetService(typeof(IMetricsService)))
            .Returns(metrics.Object);

        var settings = Options.Create(new TogglySettings
        {
            AppKey = AppKey,
            Environment = EnvironmentName,
            DefinitionsBaseUrl = DefinitionsBaseUrl,
            UseSignedDefinitions = false
        });

        var provider = new TogglyFeatureProvider(
            settings,
            hostEnvironment.Object,
            loggerFactory.Object,
            httpClientFactory.Object,
            serviceProvider.Object);

        // Force the unsigned definitions HTTP path to complete before evaluation.
        _ = await provider.GetFeatureDefinitionAsync("__warmup__");
        handler.DefinitionsRequests.Should().BeGreaterThan(0,
            "TogglyFeatureProvider must fetch definitions via mocked HttpMessageHandler");
        // Request alone is not enough: a failed apply leaves _loaded false and
        // IsEnabledAsync defaults to false, which would vacuously pass negative fixtures.
        provider.GetDebugInfo().Loaded.Should().BeTrue(
            "definitions must load successfully before public-API evaluation");

        var httpContext = new DefaultHttpContext();
        var httpAccessor = new HttpContextAccessor();
        var targetingAccessor = new Mock<ITargetingContextAccessor>();
        targetingAccessor.Setup(a => a.GetContextAsync()).ReturnsAsync(new TargetingContext
        {
            UserId = null,
            Groups = Array.Empty<string>()
        });

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IHttpContextAccessor>(httpAccessor);
        services.AddSingleton(targetingAccessor.Object);
        services.AddSingleton<IFeatureDefinitionProvider>(provider);
        services.AddSingleton<IFeatureDefinitionModelProvider>(provider);
        services.Configure<TargetingEvaluationOptions>(o => o.IgnoreCase = ignoreCase);

        services.AddFeatureManagement()
            .AddFeatureFilter<TimeWindowFilter>()
            .AddFeatureFilter<ContextPropertyFilter>()
            .AddFeatureFilter<AlwaysOnFeatureFilter>()
            .AddFeatureFilter<TogglyPercentageFilter>()
            .AddFeatureFilter<TogglyTargetingFilter>()
            .AddFeatureFilter<BrowserFamilyFilter>()
            .AddFeatureFilter<BrowserLanguageFilter>()
            .AddFeatureFilter<CountryFilter>()
            .AddFeatureFilter<DeviceTypeFilter>()
            .AddFeatureFilter<OSFilter>()
            .AddFeatureFilter<UserClaimsFilter>();

        RemoveFeatureFilter(services, typeof(PercentageFilter));
        RemoveFeatureFilter(services, typeof(TargetingFilter));

        services.Configure<FeatureManagementOptions>(options =>
        {
            options.IgnoreMissingFeatureFilters = false;
        });

        var sp = services.BuildServiceProvider();
        return new ContractHarness(provider, httpClient, sp, httpContext, httpAccessor, targetingAccessor);
    }

    private static DotNetExpectation ResolveDotNetExpectation(JsonElement root)
    {
        var expected = root.GetProperty("expected").GetBoolean();
        if (!root.TryGetProperty("sdkExpectations", out var sdkMap)
            || sdkMap.ValueKind != JsonValueKind.Object
            || !sdkMap.TryGetProperty("dotnet", out var sdk)
            || sdk.ValueKind != JsonValueKind.Object)
        {
            return DotNetExpectation.Boolean(expected);
        }

        if (sdk.TryGetProperty("outcome", out var outcome))
        {
            if (outcome.ValueKind == JsonValueKind.String
                && string.Equals(outcome.GetString(), "error", StringComparison.OrdinalIgnoreCase))
            {
                return DotNetExpectation.Error();
            }

            if (outcome.ValueKind is JsonValueKind.True or JsonValueKind.False)
                return DotNetExpectation.Boolean(outcome.GetBoolean());
        }

        if (sdk.TryGetProperty("allowedOutcomes", out var allowed)
            && allowed.ValueKind == JsonValueKind.Array)
        {
            var values = allowed.EnumerateArray()
                .Where(e => e.ValueKind is JsonValueKind.True or JsonValueKind.False)
                .Select(e => e.GetBoolean())
                .ToArray();
            if (values.Length > 0)
                return DotNetExpectation.Allowed(values);
        }

        return DotNetExpectation.Boolean(expected);
    }

    private readonly struct DotNetExpectation
    {
        public bool ExpectError { get; }
        public bool ExpectedBoolean { get; }
        public bool[]? AllowedOutcomes { get; }

        private DotNetExpectation(bool expectError, bool expectedBoolean, bool[]? allowedOutcomes)
        {
            ExpectError = expectError;
            ExpectedBoolean = expectedBoolean;
            AllowedOutcomes = allowedOutcomes;
        }

        public static DotNetExpectation Boolean(bool value) => new(false, value, null);
        public static DotNetExpectation Error() => new(true, false, null);
        public static DotNetExpectation Allowed(bool[] values) => new(false, false, values);
    }

    private static string JsonElementToParameterString(JsonElement value) =>
        value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => string.Empty,
            _ => value.GetRawText()
        };

    private static string? TryGetString(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    private static string[]? TryGetStringArray(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        if (current.ValueKind != JsonValueKind.Array)
            return null;

        return current.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.String)
            .Select(e => e.GetString()!)
            .ToArray();
    }

    private static Dictionary<string, string>? TryGetStringMap(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        if (current.ValueKind != JsonValueKind.Object)
            return null;

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in current.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.String)
                map[property.Name] = property.Value.GetString() ?? string.Empty;
            else
                map[property.Name] = property.Value.GetRawText();
        }

        return map;
    }

    private static void RemoveFeatureFilter(ServiceCollection services, Type implementationType)
    {
        var descriptors = services
            .Where(d => d.ServiceType == typeof(IFeatureFilterMetadata) && d.ImplementationType == implementationType)
            .ToList();
        foreach (var descriptor in descriptors)
            services.Remove(descriptor);
    }

    private static JsonNode? ConfigSectionToJsonNode(IConfigurationSection? section)
    {
        if (section is null)
            return null;

        var children = section.GetChildren().ToList();
        if (children.Count == 0)
            return section.Value is null ? null : InferScalarNode(section.Value);

        var isArray = children
            .Select((c, i) => c.Key == i.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .All(match => match);

        if (isArray)
        {
            var array = new JsonArray();
            foreach (var child in children)
                array.Add(ConfigSectionToJsonNode(child));
            return array;
        }

        var obj = new JsonObject();
        foreach (var child in children)
            obj[child.Key] = ConfigSectionToJsonNode(child);
        return obj;
    }

    private static JsonValue InferScalarNode(string value)
    {
        if (bool.TryParse(value, out var b))
            return JsonValue.Create(b)!;
        if (long.TryParse(value, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var l))
            return JsonValue.Create(l)!;
        if (double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
            return JsonValue.Create(d)!;
        return JsonValue.Create(value)!;
    }

    private sealed class DefinitionsHttpHandler : HttpMessageHandler
    {
        private readonly string _definitionsJson;
        private int _definitionsRequests;

        public DefinitionsHttpHandler(string definitionsJson) => _definitionsJson = definitionsJson;

        public int DefinitionsRequests => Volatile.Read(ref _definitionsRequests);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? string.Empty;
            if (path.Contains($"definitions/{AppKey}/{EnvironmentName}", StringComparison.OrdinalIgnoreCase))
            {
                Interlocked.Increment(ref _definitionsRequests);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(_definitionsJson, Encoding.UTF8, "application/json")
                });
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json")
            });
        }
    }

    private sealed class ContractHarness : IDisposable
    {
        public TogglyFeatureProvider Provider { get; }
        public ServiceProvider Services { get; }
        public DefaultHttpContext HttpContext { get; }
        public HttpContextAccessor HttpAccessor { get; }
        public Mock<ITargetingContextAccessor> TargetingAccessor { get; }
        private readonly HttpClient _httpClient;

        public ContractHarness(
            TogglyFeatureProvider provider,
            HttpClient httpClient,
            ServiceProvider services,
            DefaultHttpContext httpContext,
            HttpContextAccessor httpAccessor,
            Mock<ITargetingContextAccessor> targetingAccessor)
        {
            Provider = provider;
            _httpClient = httpClient;
            Services = services;
            HttpContext = httpContext;
            HttpAccessor = httpAccessor;
            TargetingAccessor = targetingAccessor;
        }

        public void Dispose()
        {
            Provider.Dispose();
            Services.Dispose();
            _httpClient.Dispose();
            GC.SuppressFinalize(this);
        }
    }
}
