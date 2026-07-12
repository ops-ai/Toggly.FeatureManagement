using FluentAssertions;
using Microsoft.Extensions.Options;
using EphemeralMongo;
using MongoDB.Driver;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Storage.MongoDB;
using Xunit;

namespace Toggly.Storage.MongoDB.Tests;

public class MongoDBFeatureSnapshotProviderTests : IAsyncLifetime
{
    private IMongoRunner _runner = null!;
    private IMongoClient _client = null!;
    private MongoDBFeatureSnapshotProvider _provider = null!;
    private IOptions<TogglySnapshotSettings> _settings = null!;
    private const string TestDatabaseName = "toggly_tests";
    private const string TestCollectionName = "snapshots";

    public Task InitializeAsync()
    {
        _runner = MongoRunner.Run();
        _client = new MongoClient(_runner.ConnectionString);

        _settings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "test_features",
            JwkDocumentName = "test_jwks",
            DatabaseName = TestDatabaseName,
            CollectionName = TestCollectionName
        });

        _provider = new MongoDBFeatureSnapshotProvider(_client, _settings);

        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _runner?.Dispose();
        return Task.CompletedTask;
    }

    #region GetFeaturesSnapshotAsync Tests

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WhenNoDataExists_ReturnsNulls()
    {
        // Act
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var features = snapshot?.Features;
        var signature = snapshot?.Signature;
        var keyId = snapshot?.KeyId;
        var timestamp = snapshot?.Timestamp;

        // Assert
        features.Should().BeNull();
        signature.Should().BeNull();
        keyId.Should().BeNull();
        timestamp.Should().BeNull();
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WhenDataExists_ReturnsStoredData()
    {
        // Arrange
        var featureDefinitions = CreateTestFeatureDefinitions();
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = featureDefinitions, Signature = "test-signature", KeyId = "key-123", Timestamp = 1700000000 });

        // Act
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var features = snapshot?.Features;
        var signature = snapshot?.Signature;
        var keyId = snapshot?.KeyId;
        var timestamp = snapshot?.Timestamp;

        // Assert
        features.Should().NotBeNull();
        features.Should().HaveCount(2);
        features![0].FeatureKey.Should().Be("feature1");
        features[1].FeatureKey.Should().Be("feature2");
        signature.Should().Be("test-signature");
        keyId.Should().Be("key-123");
        timestamp.Should().Be(1700000000);
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WithCancelledToken_ReturnsNulls()
    {
        // Arrange - save some data first
        var features = CreateTestFeatureDefinitions();
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        // Act - Provider catches OperationCanceledException and returns nulls
        var snapshot = await _provider.GetFeaturesSnapshotAsync(cts.Token);
        var result = snapshot?.Features;

        // Assert - When cancelled, provider returns nulls gracefully
        result.Should().BeNull();
    }

    #endregion

    #region SaveSnapshotAsync Tests

    [Fact]
    public async Task SaveSnapshotAsync_WithValidFeatures_PersistsData()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();

        // Act
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "sig-1", KeyId = "kid-1", Timestamp = 1700000001 });

        // Assert
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var loaded = snapshot?.Features;
        var sig = snapshot?.Signature;
        var kid = snapshot?.KeyId;
        var ts = snapshot?.Timestamp;
        loaded.Should().NotBeNull();
        loaded.Should().HaveCount(2);
        sig.Should().Be("sig-1");
        kid.Should().Be("kid-1");
        ts.Should().Be(1700000001);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithNullOptionalParameters_PersistsData()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();

        // Act
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        // Assert
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var loaded = snapshot?.Features;
        var sig = snapshot?.Signature;
        var kid = snapshot?.KeyId;
        var ts = snapshot?.Timestamp;
        loaded.Should().NotBeNull();
        sig.Should().BeNull();
        kid.Should().BeNull();
        ts.Should().BeNull();
    }

    [Fact]
    public async Task SaveSnapshotAsync_UpdatesExistingRecord()
    {
        // Arrange
        var features1 = CreateTestFeatureDefinitions();
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features1, Signature = "sig-1", KeyId = "kid-1", Timestamp = 1700000001 });

        var features2 = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "updated-feature", Filters = new List<FeatureFilter>() }
        };

        // Act
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features2, Signature = "sig-2", KeyId = "kid-2", Timestamp = 1700000002 });

        // Assert - Verify only one document exists
        var collection = _client.GetDatabase(TestDatabaseName).GetCollection<SnapshotDocument>(TestCollectionName);
        var count = await collection.CountDocumentsAsync(d => d.Id == _settings.Value.DocumentName);
        count.Should().Be(1);

        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var loaded = snapshot?.Features;
        var sig = snapshot?.Signature;
        var kid = snapshot?.KeyId;
        var ts = snapshot?.Timestamp;
        loaded.Should().HaveCount(1);
        loaded![0].FeatureKey.Should().Be("updated-feature");
        sig.Should().Be("sig-2");
        kid.Should().Be("kid-2");
        ts.Should().Be(1700000002);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithEmptyList_PersistsEmptyArray()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>();

        // Act
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        // Assert
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var loaded = snapshot?.Features;
        loaded.Should().NotBeNull();
        loaded.Should().BeEmpty();
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithComplexFeatures_SerializesCorrectly()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>
        {
            new()
            {
                FeatureKey = "complex-feature",
                SecuredFeature = true,
                RequirementType = Microsoft.FeatureManagement.RequirementType.All,
                Metrics = new List<string> { "metric1", "metric2" },
                Filters = new List<FeatureFilter>
                {
                    new()
                    {
                        Name = "Percentage",
                        Parameters = new Dictionary<string, string> { { "Value", "50" } }
                    }
                }
            }
        };

        // Act
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        // Assert
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var loaded = snapshot?.Features;
        loaded.Should().NotBeNull();
        loaded![0].FeatureKey.Should().Be("complex-feature");
        loaded[0].SecuredFeature.Should().BeTrue();
        loaded[0].RequirementType.Should().Be(Microsoft.FeatureManagement.RequirementType.All);
        loaded[0].Metrics.Should().BeEquivalentTo(new[] { "metric1", "metric2" });
        loaded[0].Filters.Should().HaveCount(1);
        loaded[0].Filters[0].Name.Should().Be("Percentage");
    }

    #endregion

    #region SaveJwkSnapshot Tests

    [Fact]
    public async Task SaveJwkSnapshot_WithValidJwks_PersistsData()
    {
        // Arrange
        var jwks = CreateTestJwks();
        var timestamp = 1700000003L;

        // Act
        await _provider.SaveJwkSnapshot(jwks, timestamp);

        // Assert
        var (loaded, ts) = await _provider.GetJwkSnapshotAsync();
        loaded.Should().NotBeNull();
        loaded!.Keys.Should().HaveCount(1);
        loaded.Keys[0].Kid.Should().Be("test-key-id");
        ts.Should().Be(timestamp);
    }

    [Fact]
    public async Task SaveJwkSnapshot_UpdatesExistingRecord()
    {
        // Arrange
        var jwks1 = CreateTestJwks();
        await _provider.SaveJwkSnapshot(jwks1, 1700000001);

        var jwks2 = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "updated-key-id", Kty = "EC" }
            }
        };

        // Act
        await _provider.SaveJwkSnapshot(jwks2, 1700000002);

        // Assert
        var collection = _client.GetDatabase(TestDatabaseName).GetCollection<SnapshotDocument>(TestCollectionName);
        var count = await collection.CountDocumentsAsync(d => d.Id == _settings.Value.JwkDocumentName);
        count.Should().Be(1);

        var (loaded, ts) = await _provider.GetJwkSnapshotAsync();
        loaded.Should().NotBeNull();
        loaded!.Keys[0].Kid.Should().Be("updated-key-id");
        ts.Should().Be(1700000002);
    }

    #endregion

    #region GetJwkSnapshotAsync Tests

    [Fact]
    public async Task GetJwkSnapshotAsync_WhenNoDataExists_ReturnsNulls()
    {
        // Act
        var (jwks, timestamp) = await _provider.GetJwkSnapshotAsync();

        // Assert
        jwks.Should().BeNull();
        timestamp.Should().BeNull();
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_WhenDataExists_ReturnsStoredData()
    {
        // Arrange
        var jwks = CreateTestJwks();
        await _provider.SaveJwkSnapshot(jwks, 1700000004);

        // Act
        var (loaded, timestamp) = await _provider.GetJwkSnapshotAsync();

        // Assert
        loaded.Should().NotBeNull();
        loaded!.Keys.Should().HaveCount(1);
        loaded.Keys[0].Kid.Should().Be("test-key-id");
        timestamp.Should().Be(1700000004);
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_WithCancelledToken_ReturnsNulls()
    {
        // Arrange - save some data first
        var jwks = CreateTestJwks();
        await _provider.SaveJwkSnapshot(jwks, 1700000000);

        var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        // Act - Provider catches OperationCanceledException and returns nulls
        var (result, _) = await _provider.GetJwkSnapshotAsync(cts.Token);

        // Assert - When cancelled, provider returns nulls gracefully
        result.Should().BeNull();
    }

    #endregion

    #region Settings Tests

    [Fact]
    public async Task Provider_UsesDefaultSettings_WhenNotSpecified()
    {
        // Arrange
        var defaultSettings = Options.Create(new TogglySnapshotSettings());
        var provider = new MongoDBFeatureSnapshotProvider(_client, defaultSettings);

        var features = CreateTestFeatureDefinitions();

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });

        // Assert
        var collection = _client.GetDatabase("toggly").GetCollection<SnapshotDocument>("snapshots");
        var count = await collection.CountDocumentsAsync(d => d.Id == "toggly_features");
        count.Should().Be(1);
    }

    [Fact]
    public async Task Provider_UsesCustomSettings_WhenSpecified()
    {
        // Arrange
        var customSettings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "custom_features",
            JwkDocumentName = "custom_jwks",
            DatabaseName = "custom_db",
            CollectionName = "custom_collection"
        });
        var provider = new MongoDBFeatureSnapshotProvider(_client, customSettings);

        var features = CreateTestFeatureDefinitions();
        var jwks = CreateTestJwks();

        // Act
        await provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });
        await provider.SaveJwkSnapshot(jwks, 1700000000);

        // Assert
        var collection = _client.GetDatabase("custom_db").GetCollection<SnapshotDocument>("custom_collection");
        var featureCount = await collection.CountDocumentsAsync(d => d.Id == "custom_features");
        var jwksCount = await collection.CountDocumentsAsync(d => d.Id == "custom_jwks");

        featureCount.Should().Be(1);
        jwksCount.Should().Be(1);
    }

    [Fact]
    public void Constructor_ThrowsArgumentNullException_WhenClientIsNull()
    {
        // Act & Assert
        var act = () => new MongoDBFeatureSnapshotProvider(null!, _settings);
        act.Should().Throw<ArgumentNullException>();
    }

    #endregion

    #region Integration Tests

    [Fact]
    public async Task RoundTrip_FeaturesAndJwks_WorkCorrectly()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();
        var jwks = CreateTestJwks();

        // Act - Save
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "sig", KeyId = "kid", Timestamp = 1700000000 });
        await _provider.SaveJwkSnapshot(jwks, 1700000001);

        // Assert - Load
        var snapshot = await _provider.GetFeaturesSnapshotAsync();
        var loadedFeatures = snapshot?.Features;
        var sig = snapshot?.Signature;
        var kid = snapshot?.KeyId;
        var featureTs = snapshot?.Timestamp;
        var (loadedJwks, jwksTs) = await _provider.GetJwkSnapshotAsync();

        loadedFeatures.Should().HaveCount(2);
        loadedJwks!.Keys.Should().HaveCount(1);
        sig.Should().Be("sig");
        kid.Should().Be("kid");
        featureTs.Should().Be(1700000000);
        jwksTs.Should().Be(1700000001);
    }

    [Fact]
    public async Task SignedDefsJsonAndETag_RoundTripAndClear()
    {
        var features = CreateTestFeatureDefinitions();
        const string signedJson = "[{\"featureKey\":\"feature1\"}]";
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot
        {
            Features = features,
            Signature = "sig",
            KeyId = "kid",
            Timestamp = 1700000000,
            SignedDefsJson = signedJson,
            ETag = "rev-mongo"
        });
        await _provider.SaveJwkSnapshot(CreateTestJwks(), 1700000001);

        var loaded = await _provider.GetFeaturesSnapshotAsync();
        loaded!.SignedDefsJson.Should().Be(signedJson);
        loaded.ETag.Should().Be("rev-mongo");

        await _provider.ClearSnapshotAsync();
        await _provider.ClearJwkSnapshotAsync();

        (await _provider.GetFeaturesSnapshotAsync()).Should().BeNull();
        (await _provider.GetJwkSnapshotAsync()).Jwks.Should().BeNull();
    }

    [Fact]
    public async Task MultipleSnapshots_IndependentDocuments()
    {
        // Arrange & Act
        var features = CreateTestFeatureDefinitions();
        var jwks = CreateTestJwks();

        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features });
        await _provider.SaveJwkSnapshot(jwks, 1700000000);

        // Assert
        var collection = _client.GetDatabase(TestDatabaseName).GetCollection<SnapshotDocument>(TestCollectionName);
        var allDocs = await collection.Find(_ => true).ToListAsync();

        allDocs.Should().HaveCount(2);
        allDocs.Select(d => d.Id).Should().Contain(_settings.Value.DocumentName);
        allDocs.Select(d => d.Id).Should().Contain(_settings.Value.JwkDocumentName);
    }

    [Fact]
    public async Task MultipleProviderInstances_ShareSameData()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();
        await _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = "sig", KeyId = "kid", Timestamp = 1700000000 });

        // Create a new provider instance with the same client
        var provider2 = new MongoDBFeatureSnapshotProvider(_client, _settings);

        // Act
        var snapshot = await provider2.GetFeaturesSnapshotAsync();
        var loaded = snapshot?.Features;
        var sig = snapshot?.Signature;
        var kid = snapshot?.KeyId;
        var ts = snapshot?.Timestamp;

        // Assert
        loaded.Should().HaveCount(2);
        sig.Should().Be("sig");
    }

    #endregion

    #region Concurrent Access Tests

    [Fact]
    public async Task SaveSnapshotAsync_ConcurrentWrites_AllSucceed()
    {
        // Arrange
        var tasks = Enumerable.Range(0, 10).Select(i =>
        {
            var features = new List<FeatureDefinitionModel>
            {
                new() { FeatureKey = $"feature-{i}", Filters = new List<FeatureFilter>() }
            };
            return _provider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = features, Signature = $"sig-{i}", KeyId = $"kid-{i}", Timestamp = 1700000000 + i });
        });

        // Act
        await Task.WhenAll(tasks);

        // Assert - Only one document should exist (upsert semantics)
        var collection = _client.GetDatabase(TestDatabaseName).GetCollection<SnapshotDocument>(TestCollectionName);
        var count = await collection.CountDocumentsAsync(d => d.Id == _settings.Value.DocumentName);
        count.Should().Be(1);
    }

    #endregion

    #region Helper Methods

    private static List<FeatureDefinitionModel> CreateTestFeatureDefinitions()
    {
        return new List<FeatureDefinitionModel>
        {
            new()
            {
                FeatureKey = "feature1",
                SecuredFeature = false,
                RequirementType = Microsoft.FeatureManagement.RequirementType.Any,
                Filters = new List<FeatureFilter>
                {
                    new() { Name = "AlwaysOn", Parameters = null }
                }
            },
            new()
            {
                FeatureKey = "feature2",
                SecuredFeature = true,
                RequirementType = Microsoft.FeatureManagement.RequirementType.All,
                Metrics = new List<string> { "impressions" },
                Filters = new List<FeatureFilter>
                {
                    new()
                    {
                        Name = "Percentage",
                        Parameters = new Dictionary<string, string> { { "Value", "25" } }
                    }
                }
            }
        };
    }

    private static JsonWebKeySet CreateTestJwks()
    {
        return new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new()
                {
                    Kid = "test-key-id",
                    Kty = "EC",
                    Crv = "P-256",
                    X = "test-x-value",
                    Y = "test-y-value",
                    Use = "sig",
                    Alg = "ES256"
                }
            }
        };
    }

    #endregion
}
