using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Storage.EntityFramework;
using Xunit;

namespace Toggly.Storage.EntityFramework.Tests;

public class EntityFrameworkFeatureSnapshotProviderTests : IAsyncLifetime
{
    private TogglyEntities _context = null!;
    private EntityFrameworkFeatureSnapshotProvider _provider = null!;
    private IOptions<TogglySnapshotSettings> _settings = null!;

    public async Task InitializeAsync()
    {
        var options = new DbContextOptionsBuilder<TogglyEntities>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _context = new TogglyEntities(options);
        await _context.Database.OpenConnectionAsync();
        await _context.Database.EnsureCreatedAsync();

        _settings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "test_features",
            JwkDocumentName = "test_jwks",
            AutoCreateTable = true
        });

        _provider = new EntityFrameworkFeatureSnapshotProvider(_context, _settings);
    }

    public async Task DisposeAsync()
    {
        await _context.Database.CloseConnectionAsync();
        await _context.DisposeAsync();
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

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WithCancelledToken_ReturnsNulls()
    {
        // Arrange - save some data first
        var features = CreateTestFeatureDefinitions();
        await _provider.SaveSnapshotAsync(features);

        var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        // Act - Provider catches OperationCanceledException and returns nulls
        var (result, _, _, _) = await _provider.GetFeaturesSnapshotAsync(cts.Token);

        // Assert - When cancelled, provider returns nulls gracefully
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WithEmptyData_ReturnsNulls()
    {
        // Arrange - insert empty data directly
        var snapshot = new SnapshotEntity
        {
            Id = _settings.Value.DocumentName!,
            Data = "",
            UpdatedAt = DateTime.UtcNow
        };
        await _context.TogglySnapshots.AddAsync(snapshot);
        await _context.SaveChangesAsync();

        // Act
        var (features, signature, keyId, timestamp) = await _provider.GetFeaturesSnapshotAsync();

        // Assert
        features.Should().BeNull();
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
        var saved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == _settings.Value.DocumentName);
        saved.Should().NotBeNull();
        saved!.Data.Should().Contain("feature1");
        saved.Signature.Should().Be("sig-1");
        saved.KeyId.Should().Be("kid-1");
        saved.Timestamp.Should().Be(1700000001);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithNullOptionalParameters_PersistsData()
    {
        // Arrange
        var features = CreateTestFeatureDefinitions();

        // Act
        await _provider.SaveSnapshotAsync(features);

        // Assert
        var saved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == _settings.Value.DocumentName);
        saved.Should().NotBeNull();
        saved!.Signature.Should().BeNull();
        saved.KeyId.Should().BeNull();
        saved.Timestamp.Should().BeNull();
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
        var count = await _context.TogglySnapshots.CountAsync(s => s.Id == _settings.Value.DocumentName);
        count.Should().Be(1);

        var saved = await _context.TogglySnapshots.FirstAsync(s => s.Id == _settings.Value.DocumentName);
        saved.Data.Should().Contain("updated-feature");
        saved.Signature.Should().Be("sig-2");
        saved.KeyId.Should().Be("kid-2");
        saved.Timestamp.Should().Be(1700000002);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithEmptyList_PersistsEmptyArray()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>();

        // Act
        await _provider.SaveSnapshotAsync(features);

        // Assert
        var saved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == _settings.Value.DocumentName);
        saved.Should().NotBeNull();
        saved!.Data.Should().Be("[]");
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
        var (retrieved, _, _, _) = await _provider.GetFeaturesSnapshotAsync();
        retrieved.Should().NotBeNull();
        retrieved![0].FeatureKey.Should().Be("complex-feature");
        retrieved[0].SecuredFeature.Should().BeTrue();
        retrieved[0].RequirementType.Should().Be(Microsoft.FeatureManagement.RequirementType.All);
        retrieved[0].Metrics.Should().BeEquivalentTo(new[] { "metric1", "metric2" });
        retrieved[0].Filters.Should().HaveCount(1);
        retrieved[0].Filters[0].Name.Should().Be("Percentage");
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
        var saved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == _settings.Value.JwkDocumentName);
        saved.Should().NotBeNull();
        saved!.Timestamp.Should().Be(timestamp);
        saved.Data.Should().Contain("test-key-id");
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
        var count = await _context.TogglySnapshots.CountAsync(s => s.Id == _settings.Value.JwkDocumentName);
        count.Should().Be(1);

        var saved = await _context.TogglySnapshots.FirstAsync(s => s.Id == _settings.Value.JwkDocumentName);
        saved.Data.Should().Contain("updated-key-id");
        saved.Timestamp.Should().Be(1700000002);
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
        var (retrieved, timestamp) = await _provider.GetJwkSnapshotAsync();

        // Assert
        retrieved.Should().NotBeNull();
        retrieved!.Keys.Should().HaveCount(1);
        retrieved.Keys[0].Kid.Should().Be("test-key-id");
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

    [Fact]
    public async Task GetJwkSnapshotAsync_WithEmptyData_ReturnsNulls()
    {
        // Arrange - insert empty data directly
        var snapshot = new SnapshotEntity
        {
            Id = _settings.Value.JwkDocumentName!,
            Data = "",
            UpdatedAt = DateTime.UtcNow
        };
        await _context.TogglySnapshots.AddAsync(snapshot);
        await _context.SaveChangesAsync();

        // Act
        var (jwks, timestamp) = await _provider.GetJwkSnapshotAsync();

        // Assert
        jwks.Should().BeNull();
    }

    #endregion

    #region Settings Tests

    [Fact]
    public async Task Provider_UsesDefaultDocumentNames_WhenNotSpecified()
    {
        // Arrange
        var defaultSettings = Options.Create(new TogglySnapshotSettings());
        var provider = new EntityFrameworkFeatureSnapshotProvider(_context, defaultSettings);

        var features = CreateTestFeatureDefinitions();
        await provider.SaveSnapshotAsync(features);

        // Assert
        var saved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == "toggly_features");
        saved.Should().NotBeNull();
    }

    [Fact]
    public async Task Provider_UsesCustomDocumentNames_WhenSpecified()
    {
        // Arrange
        var customSettings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "custom_features",
            JwkDocumentName = "custom_jwks"
        });
        var provider = new EntityFrameworkFeatureSnapshotProvider(_context, customSettings);

        var features = CreateTestFeatureDefinitions();
        await provider.SaveSnapshotAsync(features);

        var jwks = CreateTestJwks();
        await provider.SaveJwkSnapshot(jwks, 1700000000);

        // Assert
        var featuresSaved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == "custom_features");
        var jwksSaved = await _context.TogglySnapshots.FirstOrDefaultAsync(s => s.Id == "custom_jwks");

        featuresSaved.Should().NotBeNull();
        jwksSaved.Should().NotBeNull();
    }

    #endregion

    #region Concurrent Access Tests

    [Fact]
    public async Task SaveSnapshotAsync_ConcurrentWrites_LastWriteWins()
    {
        // Arrange
        var tasks = Enumerable.Range(0, 10).Select(i =>
        {
            var features = new List<FeatureDefinitionModel>
            {
                new() { FeatureKey = $"feature-{i}", Filters = new List<FeatureFilter>() }
            };
            return _provider.SaveSnapshotAsync(features, $"sig-{i}", $"kid-{i}", 1700000000 + i);
        });

        // Act
        await Task.WhenAll(tasks);

        // Assert
        var count = await _context.TogglySnapshots.CountAsync(s => s.Id == _settings.Value.DocumentName);
        count.Should().Be(1);
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
    public async Task MultipleSnapshots_IndependentDocuments()
    {
        // Arrange & Act
        var features = CreateTestFeatureDefinitions();
        var jwks = CreateTestJwks();

        await _provider.SaveSnapshotAsync(features);
        await _provider.SaveJwkSnapshot(jwks, 1700000000);

        // Assert
        var allSnapshots = await _context.TogglySnapshots.ToListAsync();
        allSnapshots.Should().HaveCount(2);
        allSnapshots.Select(s => s.Id).Should().Contain(_settings.Value.DocumentName);
        allSnapshots.Select(s => s.Id).Should().Contain(_settings.Value.JwkDocumentName);
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
