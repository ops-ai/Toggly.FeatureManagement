using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Raven.Client.Documents;
using Raven.Client.Documents.Session;
using Raven.Client.Exceptions;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.RavenDB.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public sealed class RavenDbCatalogStoreTests
{
    [Fact]
    public async Task ReadAsync_returns_null_only_when_the_catalog_is_absent()
    {
        var session = CreateSession();
        session.Setup(s => s.LoadAsync<CatalogStorageDocument>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult<CatalogStorageDocument?>(null));
        var store = CreateStore(session.Object);

        var result = await store.ReadAsync("orders");

        result.Should().BeNull();
        session.Verify(s => s.Dispose(), Times.Once);
    }

    [Fact]
    public async Task TryWriteAsync_creates_a_catalog_at_the_hashed_catalog_document_id()
    {
        var session = CreateSession();
        session.Setup(s => s.LoadAsync<CatalogStorageDocument>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult<CatalogStorageDocument?>(null));
        CatalogStorageDocument? stored = null;
        session.Setup(s => s.StoreAsync(It.IsAny<CatalogStorageDocument>(), It.IsAny<CancellationToken>()))
            .Callback<object, CancellationToken>((document, _) => stored = (CatalogStorageDocument)document)
            .Returns(Task.CompletedTask);
        session.Setup(s => s.SaveChangesAsync(It.IsAny<CancellationToken>())).Returns(Task.CompletedTask);
        var store = CreateStore(session.Object);

        var result = await store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        result.Status.Should().Be(CatalogWriteStatus.Written);
        result.Snapshot!.CatalogName.Should().Be("orders");
        result.Snapshot.Document.Features.Single().Key.Should().Be("Orders");
        stored.Should().NotBeNull();
        stored!.Id.Should().Be("TogglyCatalogs/1c168adb00d208e42f93314529f1fa9c0427eb63233ceda95a5db52b7012a719");
        stored.Revision.Should().NotBeNullOrWhiteSpace();
        session.Object.Advanced.UseOptimisticConcurrency.Should().BeTrue();
    }

    [Fact]
    public async Task TryWriteAsync_rejects_a_stale_revision_without_saving()
    {
        var existing = StorageDocument("orders", "current", "Orders");
        var session = CreateSession();
        session.Setup(s => s.LoadAsync<CatalogStorageDocument>(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(existing);
        var store = CreateStore(session.Object);

        var result = await store.TryWriteAsync("orders", Document("Replacement"), "stale");

        result.Status.Should().Be(CatalogWriteStatus.Conflict);
        result.Snapshot!.Revision.Should().Be("current");
        result.Snapshot.Document.Features.Single().Key.Should().Be("Orders");
        session.Verify(s => s.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task TryWriteAsync_returns_the_current_catalog_after_a_change_vector_conflict()
    {
        var updateSession = CreateSession();
        updateSession.Setup(s => s.LoadAsync<CatalogStorageDocument>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(StorageDocument("orders", "old", "Orders"));
        updateSession.Setup(s => s.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ConcurrencyException("competing update"));
        var readSession = CreateSession();
        readSession.Setup(s => s.LoadAsync<CatalogStorageDocument>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(StorageDocument("orders", "current", "Current"));
        var documentStore = new Mock<IDocumentStore>();
        documentStore.SetupSequence(s => s.OpenAsyncSession())
            .Returns(updateSession.Object)
            .Returns(readSession.Object);
        var store = new RavenDbCatalogStore(documentStore.Object);

        var result = await store.TryWriteAsync("orders", Document("Replacement"), "old");

        result.Status.Should().Be(CatalogWriteStatus.Conflict);
        result.Snapshot!.Revision.Should().Be("current");
        result.Snapshot.Document.Features.Single().Key.Should().Be("Current");
        updateSession.Verify(s => s.Dispose(), Times.Once);
        readSession.Verify(s => s.Dispose(), Times.Once);
    }

    [Fact]
    public async Task ReadAsync_propagates_storage_errors_instead_of_reporting_absence()
    {
        var session = CreateSession();
        session.Setup(s => s.LoadAsync<CatalogStorageDocument>(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("storage unavailable"));
        var store = CreateStore(session.Object);

        var action = () => store.ReadAsync("orders");

        await action.Should().ThrowAsync<InvalidOperationException>().WithMessage("storage unavailable");
    }

    [Fact]
    public void AddTogglyRavenDbCatalogStore_registers_one_catalog_store()
    {
        var services = new Microsoft.Extensions.DependencyInjection.ServiceCollection();
        services.AddSingleton(Mock.Of<IDocumentStore>());

        services.AddTogglyRavenDbCatalogStore();
        services.AddTogglyRavenDbCatalogStore();
        using var provider = services.BuildServiceProvider();

        provider.GetServices<ITogglyCatalogStore>().Should().ContainSingle().Which.Should().BeOfType<RavenDbCatalogStore>();
    }

    private static RavenDbCatalogStore CreateStore(IAsyncDocumentSession session)
    {
        var documentStore = new Mock<IDocumentStore>();
        documentStore.Setup(s => s.OpenAsyncSession()).Returns(session);
        return new RavenDbCatalogStore(documentStore.Object);
    }

    private static Mock<IAsyncDocumentSession> CreateSession()
    {
        var session = new Mock<IAsyncDocumentSession>();
        var advanced = new Mock<IAsyncAdvancedSessionOperations>();
        advanced.SetupProperty(s => s.UseOptimisticConcurrency);
        session.SetupGet(s => s.Advanced).Returns(advanced.Object);
        return session;
    }

    private static CatalogStorageDocument StorageDocument(string catalogName, string revision, string key) => new()
    {
        Id = "TogglyCatalogs/" + RavenDbCatalogStore.GetCatalogId(catalogName),
        CatalogName = catalogName,
        Revision = revision,
        UpdatedAtUtc = DateTimeOffset.UtcNow,
        Payload = CatalogJson.Serialize(Document(key))
    };

    private static CatalogDocument Document(string key) => new()
    {
        Features = new List<CatalogFeature>
        {
            new() { Key = key, Name = key, Description = string.Empty, Enabled = false }
        }
    };
}
