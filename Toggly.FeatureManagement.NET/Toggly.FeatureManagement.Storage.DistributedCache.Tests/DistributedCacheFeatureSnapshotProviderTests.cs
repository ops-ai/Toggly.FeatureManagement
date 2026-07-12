using FluentAssertions;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Storage.DistributedCache;
using Xunit;

namespace Toggly.FeatureManagement.Storage.DistributedCache.Tests;

public class DistributedCacheFeatureSnapshotProviderTests
{
    private static MemoryDistributedCache CreateCache() =>
        new(Options.Create(new MemoryDistributedCacheOptions()));

    private static DistributedCacheFeatureSnapshotProvider CreateProvider(
        IDistributedCache cache,
        TogglySnapshotSettings? settings = null)
    {
        return new DistributedCacheFeatureSnapshotProvider(
            cache,
            Options.Create(settings ?? new TogglySnapshotSettings()));
    }

    #region GetFeaturesSnapshotAsync Tests

    [Fact]
    public async Task GetFeaturesSnapshotAsync_ReturnsNullTuple_WhenCacheIsEmpty()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);

        // Act
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_ReturnsFeatures_WhenCacheHasData()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "feature1" },
            new() { FeatureKey = "feature2" }
        };

        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "sig123", KeyId = "key456", Timestamp = 1234567890L });

        // Act
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().HaveCount(2);
        result.Features![0].FeatureKey.Should().Be("feature1");
        result.Features[1].FeatureKey.Should().Be("feature2");
        result.Signature.Should().Be("sig123");
        result.KeyId.Should().Be("key456");
        result.Timestamp.Should().Be(1234567890L);
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_UsesDefaultDocumentName_WhenNotConfigured()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "default-doc-test" }
        };

        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        // Act - Create new provider with same cache to verify it reads from same location
        var provider2 = CreateProvider(cache);
        var result = await provider2.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().HaveCount(1);
        result.Features![0].FeatureKey.Should().Be("default-doc-test");
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_UsesCustomDocumentName_WhenConfigured()
    {
        // Arrange
        var cache = CreateCache();
        var customSettings = new TogglySnapshotSettings { DocumentName = "CustomFeatures" };
        var provider = CreateProvider(cache, customSettings);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "custom-doc-feature" }
        };

        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "sig", KeyId = "key", Timestamp = 123L });

        // Act - Provider with default settings should not find the data
        var defaultProvider = CreateProvider(cache);
        var defaultResult = await defaultProvider.GetFeaturesSnapshotAsync();

        // Act - Provider with same custom settings should find the data
        var customProvider = CreateProvider(cache, customSettings);
        var customResult = await customProvider.GetFeaturesSnapshotAsync();

        // Assert
        defaultResult.Should().BeNull();
        customResult.Features.Should().HaveCount(1);
        customResult.Features![0].FeatureKey.Should().Be("custom-doc-feature");
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_AcceptsCancellationToken()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var cts = new CancellationTokenSource();

        // Act - Should complete without error
        var result = await provider.GetFeaturesSnapshotAsync(cts.Token);

        // Assert
        result.Should().BeNull();
    }

    #endregion

    #region SaveSnapshotAsync Tests

    [Fact]
    public async Task SaveSnapshotAsync_StoresFeaturesInCache()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "stored-feature", SecuredFeature = true }
        };

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "signature", KeyId = "keyId", Timestamp = 9876543210L });

        // Assert
        var result = await provider.GetFeaturesSnapshotAsync();
        result.Features.Should().HaveCount(1);
        result.Features![0].FeatureKey.Should().Be("stored-feature");
        result.Features[0].SecuredFeature.Should().BeTrue();
    }

    [Fact]
    public async Task SaveSnapshotAsync_OverwritesExistingData()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var originalFeatures = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "original" }
        };
        var updatedFeatures = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "updated1" },
            new() { FeatureKey = "updated2" }
        };

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = originalFeatures, Signature = "sig1", KeyId = "key1", Timestamp = 100L });
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = updatedFeatures, Signature = "sig2", KeyId = "key2", Timestamp = 200L });

        // Assert
        var result = await provider.GetFeaturesSnapshotAsync();
        result.Features.Should().HaveCount(2);
        result.Features![0].FeatureKey.Should().Be("updated1");
        result.Signature.Should().Be("sig2");
        result.Timestamp.Should().Be(200L);
    }

    [Fact]
    public async Task SaveSnapshotAsync_HandlesNullSignatureAndKeyId()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "no-sig-feature" }
        };

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        // Assert
        var result = await provider.GetFeaturesSnapshotAsync();
        result.Features.Should().HaveCount(1);
        result.Signature.Should().BeNull();
        result.KeyId.Should().BeNull();
        result.Timestamp.Should().BeNull();
    }

    [Fact]
    public async Task SaveSnapshotAsync_SerializesComplexFeatures()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new()
            {
                FeatureKey = "complex-feature",
                RequirementType = RequirementType.All,
                Filters = new List<FeatureFilter>
                {
                    new()
                    {
                        Name = "Percentage",
                        Parameters = new Dictionary<string, string>
                        {
                            { "Value", "50" }
                        }
                    },
                    new()
                    {
                        Name = "Targeting",
                        Parameters = new Dictionary<string, string>
                        {
                            { "Audience", "beta-users" }
                        }
                    }
                }
            }
        };

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "complex-sig", KeyId = "complex-key", Timestamp = 123456L });

        // Assert
        var result = await provider.GetFeaturesSnapshotAsync();
        result.Features.Should().HaveCount(1);
        var feature = result.Features![0];
        feature.FeatureKey.Should().Be("complex-feature");
        feature.Filters.Should().HaveCount(2);
        feature.Filters![0].Name.Should().Be("Percentage");
        feature.Filters[1].Name.Should().Be("Targeting");
    }

    [Fact]
    public async Task SaveSnapshotAsync_AcceptsCancellationToken()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "ct-feature" }
        };
        var cts = new CancellationTokenSource();

        // Act - Should complete without error
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features }, cts.Token);

        // Assert
        var result = await provider.GetFeaturesSnapshotAsync();
        result.Features.Should().HaveCount(1);
    }

    #endregion

    #region GetJwkSnapshotAsync Tests

    [Fact]
    public async Task GetJwkSnapshotAsync_ReturnsNullTuple_WhenCacheIsEmpty()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);

        // Act
        var result = await provider.GetJwkSnapshotAsync();

        // Assert
        result.Jwks.Should().BeNull();
        result.Timestamp.Should().BeNull();
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_ReturnsJwks_WhenCacheHasData()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new()
                {
                    Kid = "key1",
                    Kty = "EC",
                    Crv = "P-256"
                }
            }
        };
        var timestamp = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds();

        await provider.SaveJwkSnapshot(jwks, timestamp);

        // Act
        var result = await provider.GetJwkSnapshotAsync();

        // Assert
        result.Jwks.Should().NotBeNull();
        result.Jwks!.Keys.Should().HaveCount(1);
        result.Jwks.Keys[0].Kid.Should().Be("key1");
        result.Timestamp.Should().Be(timestamp);
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_UsesCustomJwkDocumentName_WhenConfigured()
    {
        // Arrange
        var cache = CreateCache();
        var customSettings = new TogglySnapshotSettings { JwkDocumentName = "CustomJwks" };
        var provider = CreateProvider(cache, customSettings);
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "custom-jwk" }
            }
        };
        var timestamp = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds();

        await provider.SaveJwkSnapshot(jwks, timestamp);

        // Act - Default provider should not find the data
        var defaultProvider = CreateProvider(cache);
        var defaultResult = await defaultProvider.GetJwkSnapshotAsync();

        // Act - Custom provider should find the data
        var customProvider = CreateProvider(cache, customSettings);
        var customResult = await customProvider.GetJwkSnapshotAsync();

        // Assert
        defaultResult.Jwks.Should().BeNull();
        customResult.Jwks.Should().NotBeNull();
        customResult.Jwks!.Keys[0].Kid.Should().Be("custom-jwk");
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_AcceptsCancellationToken()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var cts = new CancellationTokenSource();

        // Act - Should complete without error
        var result = await provider.GetJwkSnapshotAsync(cts.Token);

        // Assert
        result.Jwks.Should().BeNull();
    }

    #endregion

    #region SaveJwkSnapshot Tests

    [Fact]
    public async Task SaveJwkSnapshot_StoresJwksInCache()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new()
                {
                    Kid = "stored-key",
                    Kty = "EC",
                    Crv = "P-256",
                    X = "x-coordinate",
                    Y = "y-coordinate"
                }
            }
        };
        var timestamp = DateTimeOffset.UtcNow.AddHours(2).ToUnixTimeSeconds();

        // Act
        await provider.SaveJwkSnapshot(jwks, timestamp);

        // Assert
        var result = await provider.GetJwkSnapshotAsync();
        result.Jwks.Should().NotBeNull();
        result.Jwks!.Keys.Should().HaveCount(1);
        var key = result.Jwks.Keys[0];
        key.Kid.Should().Be("stored-key");
        key.Kty.Should().Be("EC");
        key.Crv.Should().Be("P-256");
        key.X.Should().Be("x-coordinate");
        key.Y.Should().Be("y-coordinate");
    }

    [Fact]
    public async Task SaveJwkSnapshot_OverwritesExistingData()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var futureTimestamp = DateTimeOffset.UtcNow.AddHours(2).ToUnixTimeSeconds();

        var originalJwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "original-key" }
            }
        };
        var updatedJwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "updated-key-1" },
                new() { Kid = "updated-key-2" }
            }
        };

        // Act
        await provider.SaveJwkSnapshot(originalJwks, futureTimestamp);
        await provider.SaveJwkSnapshot(updatedJwks, futureTimestamp + 3600);

        // Assert
        var result = await provider.GetJwkSnapshotAsync();
        result.Jwks!.Keys.Should().HaveCount(2);
        result.Jwks.Keys[0].Kid.Should().Be("updated-key-1");
        result.Timestamp.Should().Be(futureTimestamp + 3600);
    }

    [Fact]
    public async Task SaveJwkSnapshot_AcceptsCancellationToken()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var timestamp = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds();
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "ct-key" }
            }
        };
        var cts = new CancellationTokenSource();

        // Act - Should complete without error
        await provider.SaveJwkSnapshot(jwks, timestamp, cts.Token);

        // Assert
        var result = await provider.GetJwkSnapshotAsync();
        result.Jwks.Should().NotBeNull();
    }

    #endregion

    #region Round-Trip Tests

    [Fact]
    public async Task FeaturesRoundTrip_PreservesAllData()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var originalFeatures = new List<FeatureDefinitionModel>
        {
            new()
            {
                FeatureKey = "feature1",
                RequirementType = RequirementType.Any,
                Filters = new List<FeatureFilter>
                {
                    new()
                    {
                        Name = "AlwaysOn",
                        Parameters = new Dictionary<string, string>()
                    }
                }
            },
            new()
            {
                FeatureKey = "feature2",
                RequirementType = RequirementType.All
            }
        };
        const string signature = "test-signature-abc123";
        const string keyId = "key-id-xyz789";
        const long timestamp = 1700000000L;

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = originalFeatures, Signature = signature, KeyId = keyId, Timestamp = timestamp });
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().HaveCount(2);
        result.Features![0].FeatureKey.Should().Be("feature1");
        result.Features[0].RequirementType.Should().Be(RequirementType.Any);
        result.Features[0].Filters.Should().HaveCount(1);
        result.Features[1].FeatureKey.Should().Be("feature2");
        result.Signature.Should().Be(signature);
        result.KeyId.Should().Be(keyId);
        result.Timestamp.Should().Be(timestamp);
    }

    [Fact]
    public async Task SignedDefsJsonAndETag_RoundTripAndClear()
    {
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "feature1", Filters = new List<FeatureFilter>() }
        };
        const string signedJson = "[{\"featureKey\":\"feature1\"}]";

        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot
        {
            Features = features,
            Signature = "sig",
            KeyId = "kid",
            Timestamp = 99,
            SignedDefsJson = signedJson,
            ETag = "rev-cache"
        });
        await provider.SaveJwkSnapshot(new JsonWebKeySet { Keys = new List<JsonWebKey> { new() { Kid = "k1" } } }, 100);

        var loaded = await provider.GetFeaturesSnapshotAsync();
        loaded!.SignedDefsJson.Should().Be(signedJson);
        loaded.ETag.Should().Be("rev-cache");

        await provider.ClearSnapshotAsync();
        await provider.ClearJwkSnapshotAsync();

        (await provider.GetFeaturesSnapshotAsync()).Should().BeNull();
        (await provider.GetJwkSnapshotAsync()).Jwks.Should().BeNull();
    }

    [Fact]
    public async Task JwksRoundTrip_PreservesAllData()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var timestamp = DateTimeOffset.UtcNow.AddDays(1).ToUnixTimeSeconds();
        var originalJwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new()
                {
                    Kid = "key-1",
                    Kty = "EC",
                    Crv = "P-256",
                    X = "x1",
                    Y = "y1"
                },
                new()
                {
                    Kid = "key-2",
                    Kty = "RSA"
                }
            }
        };

        // Act
        await provider.SaveJwkSnapshot(originalJwks, timestamp);
        var result = await provider.GetJwkSnapshotAsync();

        // Assert
        result.Jwks.Should().NotBeNull();
        result.Jwks!.Keys.Should().HaveCount(2);
        result.Jwks.Keys[0].Kid.Should().Be("key-1");
        result.Jwks.Keys[0].Kty.Should().Be("EC");
        result.Jwks.Keys[0].Crv.Should().Be("P-256");
        result.Jwks.Keys[1].Kid.Should().Be("key-2");
        result.Jwks.Keys[1].Kty.Should().Be("RSA");
        result.Timestamp.Should().Be(timestamp);
    }

    [Fact]
    public async Task SaveSnapshotAsync_PreservesMetrics()
    {
        // Arrange
        var cache = CreateCache();
        var provider = CreateProvider(cache);
        var features = new List<FeatureDefinitionModel>
        {
            new()
            {
                FeatureKey = "metrics-feature",
                Metrics = new List<string> { "page_view", "click", "conversion" }
            }
        };

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features![0].Metrics.Should().HaveCount(3);
        result.Features[0].Metrics.Should().Contain("page_view");
        result.Features[0].Metrics.Should().Contain("click");
        result.Features[0].Metrics.Should().Contain("conversion");
    }

    #endregion
}
