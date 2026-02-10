using FluentAssertions;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Options;
using System.Data;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Storage.Dapper;
using Xunit;

namespace Toggly.Storage.Dapper.Tests;

public class DapperFeatureSnapshotProviderTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private SqliteConnection _keepAliveConnection = null!;
    private DapperFeatureSnapshotProvider _provider = null!;
    private IOptions<TogglySnapshotSettings> _settings = null!;

    public Task InitializeAsync()
    {
        // Use a shared in-memory database with a unique name per test instance
        var dbName = Guid.NewGuid().ToString("N");
        _connectionString = $"DataSource={dbName};Mode=Memory;Cache=Shared";

        // Keep one connection open to prevent the in-memory database from being deleted
        _keepAliveConnection = new SqliteConnection(_connectionString);
        _keepAliveConnection.Open();

        _settings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "test_features",
            JwkDocumentName = "test_jwks",
            TableName = "TogglySnapshots",
            AutoCreateTable = true,
            Provider = DatabaseProvider.Sqlite
        });

        _provider = new DapperFeatureSnapshotProvider(
            () =>
            {
                var conn = new SqliteConnection(_connectionString);
                conn.Open();
                return conn;
            },
            _settings);

        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _keepAliveConnection.Close();
        _keepAliveConnection.Dispose();
        return Task.CompletedTask;
    }

    #region GetFeaturesSnapshotAsync Tests

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WhenNoDataExists_ReturnsNulls()
    {
        // Act
        var (features, signature, keyId, timestamp) = await _provider.GetFeaturesSnapshotAsync();

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
        await _provider.SaveSnapshotAsync(featureDefinitions, "test-signature", "key-123", 1700000000);

        // Act
        var (features, signature, keyId, timestamp) = await _provider.GetFeaturesSnapshotAsync();

        // Assert
        features.Should().NotBeNull();
        features.Should().HaveCount(2);
        features![0].FeatureKey.Should().Be("feature1");
        features[1].FeatureKey.Should().Be("feature2");
        signature.Should().Be("test-signature");
        keyId.Should().Be("key-123");
        timestamp.Should().Be(1700000000);
    }

    #endregion

    #region SaveSnapshotAsync Tests

    [Fact]
    public async Task SaveSnapshotAsync_WithValidFeatures_PersistsData()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();

        // Act
        await _provider.SaveSnapshotAsync(features, "sig-1", "kid-1", 1700000001);

        // Assert
        var (loaded, sig, kid, ts) = await _provider.GetFeaturesSnapshotAsync();
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
        await _provider.SaveSnapshotAsync(features);

        // Assert
        var (loaded, sig, kid, ts) = await _provider.GetFeaturesSnapshotAsync();
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
        await _provider.SaveSnapshotAsync(features1, "sig-1", "kid-1", 1700000001);

        var features2 = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "updated-feature", Filters = new List<FeatureFilter>() }
        };

        // Act
        await _provider.SaveSnapshotAsync(features2, "sig-2", "kid-2", 1700000002);

        // Assert
        var (loaded, sig, kid, ts) = await _provider.GetFeaturesSnapshotAsync();
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
        await _provider.SaveSnapshotAsync(features);

        // Assert
        var (loaded, _, _, _) = await _provider.GetFeaturesSnapshotAsync();
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
        await _provider.SaveSnapshotAsync(features);

        // Assert
        var (loaded, _, _, _) = await _provider.GetFeaturesSnapshotAsync();
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

    #endregion

    #region Settings Tests

    [Fact]
    public async Task Provider_UsesCustomTableName_WhenSpecified()
    {
        // Arrange
        var customSettings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "custom_features",
            JwkDocumentName = "custom_jwks",
            TableName = "CustomSnapshots",
            AutoCreateTable = true,
            Provider = DatabaseProvider.Sqlite
        });

        var provider = new DapperFeatureSnapshotProvider(
            () =>
            {
                var conn = new SqliteConnection(_connectionString);
                conn.Open();
                return conn;
            },
            customSettings);

        var features = CreateTestFeatureDefinitions();

        // Act
        await provider.SaveSnapshotAsync(features);

        // Assert
        var (loaded, _, _, _) = await provider.GetFeaturesSnapshotAsync();
        loaded.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_ThrowsArgumentNullException_WhenConnectionFactoryIsNull()
    {
        // Act & Assert
        var act = () => new DapperFeatureSnapshotProvider(null!, _settings);
        act.Should().Throw<ArgumentNullException>();
    }

    #endregion

    #region Database Provider SQL Generation Tests

    [Theory]
    [InlineData(DatabaseProvider.Sqlite)]
    [InlineData(DatabaseProvider.SqlServer)]
    [InlineData(DatabaseProvider.PostgreSql)]
    [InlineData(DatabaseProvider.MySql)]
    public void Provider_AcceptsAllDatabaseProviders(DatabaseProvider dbProvider)
    {
        // Arrange & Act
        var settings = Options.Create(new TogglySnapshotSettings
        {
            Provider = dbProvider,
            AutoCreateTable = false // Don't try to create table
        });

        var act = () => new DapperFeatureSnapshotProvider(
            () => new SqliteConnection("DataSource=:memory:"),
            settings);

        // Assert
        act.Should().NotThrow();
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
        await _provider.SaveSnapshotAsync(features, "sig", "kid", 1700000000);
        await _provider.SaveJwkSnapshot(jwks, 1700000001);

        // Assert - Load
        var (loadedFeatures, sig, kid, featureTs) = await _provider.GetFeaturesSnapshotAsync();
        var (loadedJwks, jwksTs) = await _provider.GetJwkSnapshotAsync();

        loadedFeatures.Should().HaveCount(2);
        loadedJwks!.Keys.Should().HaveCount(1);
        sig.Should().Be("sig");
        kid.Should().Be("kid");
        featureTs.Should().Be(1700000000);
        jwksTs.Should().Be(1700000001);
    }

    [Fact]
    public async Task MultipleProviderInstances_ShareSameData()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();
        await _provider.SaveSnapshotAsync(features, "sig", "kid", 1700000000);

        // Create a new provider instance with the same connection
        var provider2 = new DapperFeatureSnapshotProvider(
            () =>
            {
                var conn = new SqliteConnection(_connectionString);
                conn.Open();
                return conn;
            },
            _settings);

        // Act
        var (loaded, sig, kid, ts) = await provider2.GetFeaturesSnapshotAsync();

        // Assert
        loaded.Should().HaveCount(2);
        sig.Should().Be("sig");
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
