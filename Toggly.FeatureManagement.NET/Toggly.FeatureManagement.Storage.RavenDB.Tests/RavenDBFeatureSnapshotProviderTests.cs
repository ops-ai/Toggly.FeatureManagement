using FluentAssertions;
using Microsoft.Extensions.Options;
using Moq;
using Raven.Client.Documents;
using Raven.Client.Documents.Session;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public class RavenDBFeatureSnapshotProviderTests
{
    private readonly Mock<IDocumentStore> _storeMock;
    private readonly Mock<IAsyncDocumentSession> _sessionMock;
    private readonly IOptions<TogglySnapshotSettings> _defaultSettings;
    private readonly IOptions<TogglySnapshotSettings> _customSettings;

    public RavenDBFeatureSnapshotProviderTests()
    {
        _storeMock = new Mock<IDocumentStore>();
        _sessionMock = new Mock<IAsyncDocumentSession>();

        _storeMock.Setup(s => s.OpenAsyncSession()).Returns(_sessionMock.Object);

        _defaultSettings = Options.Create(new TogglySnapshotSettings());
        _customSettings = Options.Create(new TogglySnapshotSettings
        {
            DocumentName = "FeatureSnapshots/Custom",
            JwkDocumentName = "JwkSnapshots/Custom"
        });
    }

    #region Constructor Tests

    [Fact]
    public void Constructor_WithValidParameters_CreatesInstance()
    {
        // Act
        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Assert
        provider.Should().NotBeNull();
    }

    #endregion

    #region GetFeaturesSnapshotAsync Tests

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WhenSnapshotExists_ReturnsSnapshot()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "Feature1", Filters = new List<FeatureFilter>() },
            new() { FeatureKey = "Feature2", Filters = new List<FeatureFilter>() }
        };
        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Toggly",
            Features = features,
            Signature = "test-signature",
            KeyId = "key-123",
            Timestamp = 1700000000L
        };

        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync(snapshot);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().NotBeNull();
        result.Features.Should().HaveCount(2);
        result.Signature.Should().Be("test-signature");
        result.KeyId.Should().Be("key-123");
        result.Timestamp.Should().Be(1700000000L);
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WhenSnapshotDoesNotExist_ReturnsNulls()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().BeNull();
        result.Signature.Should().BeNull();
        result.KeyId.Should().BeNull();
        result.Timestamp.Should().BeNull();
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WithCustomDocumentName_UsesCustomName()
    {
        // Arrange
        var snapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Custom",
            Features = new List<FeatureDefinitionModel>()
        };

        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Custom", It.IsAny<CancellationToken>()))
            .ReturnsAsync(snapshot);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _customSettings);

        // Act
        await provider.GetFeaturesSnapshotAsync();

        // Assert
        _sessionMock.Verify(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Custom", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_WhenExceptionOccurs_ReturnsNulls()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("Database connection failed"));

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().BeNull();
        result.Signature.Should().BeNull();
        result.KeyId.Should().BeNull();
        result.Timestamp.Should().BeNull();
    }

    [Fact]
    public async Task GetFeaturesSnapshotAsync_DisposesSession()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.GetFeaturesSnapshotAsync();

        // Assert
        _sessionMock.Verify(s => s.Dispose(), Times.Once);
    }

    #endregion

    #region SaveSnapshotAsync Tests

    [Fact]
    public async Task SaveSnapshotAsync_WhenSnapshotDoesNotExist_CreatesNewSnapshot()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "NewFeature", Filters = new List<FeatureFilter>() }
        };

        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveSnapshotAsync(features, "sig", "kid", 123456L);

        // Assert
        _sessionMock.Verify(s => s.StoreAsync(
            It.Is<FeatureSnapshot>(snap =>
                snap.Id == "FeatureSnapshots/Toggly" &&
                snap.Features == features &&
                snap.Signature == "sig" &&
                snap.KeyId == "kid" &&
                snap.Timestamp == 123456L),
            It.IsAny<CancellationToken>()), Times.Once);
        _sessionMock.Verify(s => s.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WhenSnapshotExists_UpdatesExistingSnapshot()
    {
        // Arrange
        var existingSnapshot = new FeatureSnapshot
        {
            Id = "FeatureSnapshots/Toggly",
            Features = new List<FeatureDefinitionModel>(),
            Signature = "old-sig",
            KeyId = "old-kid",
            Timestamp = 100L
        };

        var newFeatures = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "UpdatedFeature", Filters = new List<FeatureFilter>() }
        };

        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingSnapshot);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveSnapshotAsync(newFeatures, "new-sig", "new-kid", 200L);

        // Assert
        existingSnapshot.Features.Should().BeSameAs(newFeatures);
        existingSnapshot.Signature.Should().Be("new-sig");
        existingSnapshot.KeyId.Should().Be("new-kid");
        existingSnapshot.Timestamp.Should().Be(200L);
        _sessionMock.Verify(s => s.StoreAsync(It.IsAny<FeatureSnapshot>(), It.IsAny<CancellationToken>()), Times.Never);
        _sessionMock.Verify(s => s.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithCustomDocumentName_UsesCustomName()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>();

        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Custom", It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _customSettings);

        // Act
        await provider.SaveSnapshotAsync(features);

        // Assert
        _sessionMock.Verify(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Custom", It.IsAny<CancellationToken>()), Times.Once);
        _sessionMock.Verify(s => s.StoreAsync(
            It.Is<FeatureSnapshot>(snap => snap.Id == "FeatureSnapshots/Custom"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SaveSnapshotAsync_WithNullOptionalParameters_SavesWithNulls()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>();

        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveSnapshotAsync(features);

        // Assert
        _sessionMock.Verify(s => s.StoreAsync(
            It.Is<FeatureSnapshot>(snap =>
                snap.Signature == null &&
                snap.KeyId == null &&
                snap.Timestamp == null),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SaveSnapshotAsync_DisposesSession()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<FeatureSnapshot>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveSnapshotAsync(new List<FeatureDefinitionModel>());

        // Assert
        _sessionMock.Verify(s => s.Dispose(), Times.Once);
    }

    #endregion

    #region SaveJwkSnapshot Tests

    [Fact]
    public async Task SaveJwkSnapshot_WhenSnapshotDoesNotExist_CreatesNewSnapshot()
    {
        // Arrange
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "key-1", Kty = "EC" }
            }
        };

        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync((JwkSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveJwkSnapshot(jwks, 1700000000L);

        // Assert
        _sessionMock.Verify(s => s.StoreAsync(
            It.Is<JwkSnapshot>(snap =>
                snap.Id == "JwkSnapshots/Toggly" &&
                snap.Jwks == jwks &&
                snap.Timestamp == 1700000000L),
            It.IsAny<CancellationToken>()), Times.Once);
        _sessionMock.Verify(s => s.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SaveJwkSnapshot_WhenSnapshotExists_DoesNotUpdate()
    {
        // Arrange
        var existingSnapshot = new JwkSnapshot
        {
            Id = "JwkSnapshots/Toggly",
            Jwks = new JsonWebKeySet(),
            Timestamp = 100L
        };

        var newJwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey> { new() { Kid = "new-key" } }
        };

        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync(existingSnapshot);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveJwkSnapshot(newJwks, 200L);

        // Assert
        // Should not store or save since snapshot already exists
        _sessionMock.Verify(s => s.StoreAsync(It.IsAny<JwkSnapshot>(), It.IsAny<CancellationToken>()), Times.Never);
        _sessionMock.Verify(s => s.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SaveJwkSnapshot_WithCustomDocumentName_UsesCustomName()
    {
        // Arrange
        var jwks = new JsonWebKeySet();

        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Custom", It.IsAny<CancellationToken>()))
            .ReturnsAsync((JwkSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _customSettings);

        // Act
        await provider.SaveJwkSnapshot(jwks, 123L);

        // Assert
        _sessionMock.Verify(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Custom", It.IsAny<CancellationToken>()), Times.Once);
        _sessionMock.Verify(s => s.StoreAsync(
            It.Is<JwkSnapshot>(snap => snap.Id == "JwkSnapshots/Custom"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task SaveJwkSnapshot_DisposesSession()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((JwkSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveJwkSnapshot(new JsonWebKeySet(), 123L);

        // Assert
        _sessionMock.Verify(s => s.Dispose(), Times.Once);
    }

    #endregion

    #region GetJwkSnapshotAsync Tests

    [Fact]
    public async Task GetJwkSnapshotAsync_WhenSnapshotExists_ReturnsSnapshot()
    {
        // Arrange
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "key-1", Kty = "EC", Crv = "P-256" }
            }
        };
        var snapshot = new JwkSnapshot
        {
            Id = "JwkSnapshots/Toggly",
            Jwks = jwks,
            Timestamp = 1700000000L
        };

        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync(snapshot);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        var result = await provider.GetJwkSnapshotAsync();

        // Assert
        result.Jwks.Should().NotBeNull();
        result.Jwks!.Keys.Should().HaveCount(1);
        result.Jwks.Keys![0].Kid.Should().Be("key-1");
        result.Timestamp.Should().Be(1700000000L);
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_WhenSnapshotDoesNotExist_ReturnsNulls()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync((JwkSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        var result = await provider.GetJwkSnapshotAsync();

        // Assert
        result.Jwks.Should().BeNull();
        result.Timestamp.Should().BeNull();
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_WithCustomDocumentName_UsesCustomName()
    {
        // Arrange
        var snapshot = new JwkSnapshot
        {
            Id = "JwkSnapshots/Custom",
            Jwks = new JsonWebKeySet(),
            Timestamp = 123L
        };

        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Custom", It.IsAny<CancellationToken>()))
            .ReturnsAsync(snapshot);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _customSettings);

        // Act
        await provider.GetJwkSnapshotAsync();

        // Assert
        _sessionMock.Verify(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Custom", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task GetJwkSnapshotAsync_DisposesSession()
    {
        // Arrange
        _sessionMock.Setup(s => s.LoadAsync<JwkSnapshot>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((JwkSnapshot?)null);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.GetJwkSnapshotAsync();

        // Assert
        _sessionMock.Verify(s => s.Dispose(), Times.Once);
    }

    #endregion

    #region Integration-Style Tests

    [Fact]
    public async Task FullWorkflow_SaveAndRetrieveFeatures()
    {
        // Arrange
        var features = new List<FeatureDefinitionModel>
        {
            new() { FeatureKey = "TestFeature", Filters = new List<FeatureFilter>() }
        };
        FeatureSnapshot? storedSnapshot = null;

        _sessionMock.SetupSequence(s => s.LoadAsync<FeatureSnapshot>("FeatureSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync((FeatureSnapshot?)null) // First call for save
            .ReturnsAsync(() => storedSnapshot);  // Second call for get

        _sessionMock.Setup(s => s.StoreAsync(It.IsAny<FeatureSnapshot>(), It.IsAny<CancellationToken>()))
            .Callback<object, CancellationToken>((snap, _) => storedSnapshot = (FeatureSnapshot)snap)
            .Returns(Task.CompletedTask);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveSnapshotAsync(features, "sig", "kid", 123L);
        var result = await provider.GetFeaturesSnapshotAsync();

        // Assert
        result.Features.Should().HaveCount(1);
        result.Features![0].FeatureKey.Should().Be("TestFeature");
        result.Signature.Should().Be("sig");
        result.KeyId.Should().Be("kid");
        result.Timestamp.Should().Be(123L);
    }

    [Fact]
    public async Task FullWorkflow_SaveAndRetrieveJwks()
    {
        // Arrange
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new() { Kid = "test-key", Kty = "EC" }
            }
        };
        JwkSnapshot? storedSnapshot = null;

        _sessionMock.SetupSequence(s => s.LoadAsync<JwkSnapshot>("JwkSnapshots/Toggly", It.IsAny<CancellationToken>()))
            .ReturnsAsync((JwkSnapshot?)null) // First call for save
            .ReturnsAsync(() => storedSnapshot);  // Second call for get

        _sessionMock.Setup(s => s.StoreAsync(It.IsAny<JwkSnapshot>(), It.IsAny<CancellationToken>()))
            .Callback<object, CancellationToken>((snap, _) => storedSnapshot = (JwkSnapshot)snap)
            .Returns(Task.CompletedTask);

        var provider = new RavenDBFeatureSnapshotProvider(_storeMock.Object, _defaultSettings);

        // Act
        await provider.SaveJwkSnapshot(jwks, 456L);
        var result = await provider.GetJwkSnapshotAsync();

        // Assert
        result.Jwks.Should().NotBeNull();
        result.Jwks!.Keys.Should().HaveCount(1);
        result.Jwks.Keys![0].Kid.Should().Be("test-key");
        result.Timestamp.Should().Be(456L);
    }

    #endregion
}
