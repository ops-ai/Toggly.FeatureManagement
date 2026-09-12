using FluentAssertions;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Storage.DistributedCache.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Storage.DistributedCache.Tests;

public sealed class DistributedCacheCatalogStoreTests
{
    [Fact]
    public async Task ReadAsync_returns_null_only_when_the_catalog_entry_is_absent()
    {
        var store = CreateStore(CatalogCacheAccessMode.Reader);

        var snapshot = await store.ReadAsync("absent");

        snapshot.Should().BeNull();
    }

    [Fact]
    public async Task TryWriteAsync_creates_updates_and_conflicts_by_revision()
    {
        var store = CreateStore(CatalogCacheAccessMode.SingleWriter);

        var created = await store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        var duplicate = await store.TryWriteAsync("orders", Document("Duplicate"), expectedRevision: null);
        var updated = await store.TryWriteAsync("orders", Document("Updated"), created.Snapshot!.Revision);
        var stale = await store.TryWriteAsync("orders", Document("Stale"), created.Snapshot.Revision);

        created.Status.Should().Be(CatalogWriteStatus.Written);
        duplicate.Status.Should().Be(CatalogWriteStatus.Conflict);
        duplicate.Snapshot!.Revision.Should().Be(created.Snapshot.Revision);
        updated.Status.Should().Be(CatalogWriteStatus.Written);
        updated.Snapshot!.Revision.Should().NotBe(created.Snapshot.Revision);
        stale.Status.Should().Be(CatalogWriteStatus.Conflict);
        stale.Snapshot!.Revision.Should().Be(updated.Snapshot.Revision);
        stale.Snapshot.Document.Features.Should().ContainSingle().Which.Key.Should().Be("Updated");
    }

    [Fact]
    public async Task TryWriteAsync_rejects_reader_mode_without_mutating_the_cache()
    {
        var cache = new RecordingCache();
        var store = CreateStore(cache, CatalogCacheAccessMode.Reader);

        var action = () => store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        await action.Should().ThrowAsync<InvalidOperationException>().WithMessage("*Reader*write*");
        cache.SetCalls.Should().Be(0);
    }

    [Fact]
    public async Task TryWriteAsync_uses_a_process_shared_writer_gate_for_the_same_catalog()
    {
        var cache = new BlockingReadCache();
        var first = CreateStore(cache, CatalogCacheAccessMode.SingleWriter);
        var second = CreateStore(cache, CatalogCacheAccessMode.SingleWriter);

        var firstWrite = first.TryWriteAsync("writer-gate", Document("First"), expectedRevision: null);
        cache.GetCalls.Should().Be(1);

        var secondWrite = second.TryWriteAsync("writer-gate", Document("Second"), expectedRevision: null);
        cache.GetCalls.Should().Be(1, "the second writer must wait before reading the current revision");

        cache.ReleaseFirstRead();
        var firstResult = await firstWrite;
        var secondResult = await secondWrite;

        firstResult.Status.Should().Be(CatalogWriteStatus.Written);
        secondResult.Status.Should().Be(CatalogWriteStatus.Conflict);
    }

    [Fact]
    public async Task TryWriteAsync_sets_no_package_controlled_expiration()
    {
        var cache = new RecordingCache();
        var store = CreateStore(cache, CatalogCacheAccessMode.SingleWriter);

        await store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);

        cache.LastOptions.Should().NotBeNull();
        cache.LastOptions!.AbsoluteExpiration.Should().BeNull();
        cache.LastOptions.AbsoluteExpirationRelativeToNow.Should().BeNull();
        cache.LastOptions.SlidingExpiration.Should().BeNull();
    }

    [Fact]
    public async Task ReadAsync_propagates_cache_errors_instead_of_reporting_absence()
    {
        var cache = new RecordingCache { ReadException = new InvalidOperationException("cache unavailable") };
        var store = CreateStore(cache, CatalogCacheAccessMode.Reader);

        var action = () => store.ReadAsync("orders");

        await action.Should().ThrowAsync<InvalidOperationException>().WithMessage("cache unavailable");
    }

    [Fact]
    public async Task ReadAsync_rejects_a_corrupt_catalog_entry_instead_of_reporting_absence()
    {
        var cache = new RecordingCache();
        cache.Put(DistributedCacheCatalogStore.GetCatalogKey("orders"), Encoding.UTF8.GetBytes("{"));
        var store = CreateStore(cache, CatalogCacheAccessMode.Reader);

        var action = () => store.ReadAsync("orders");

        await action.Should().ThrowAsync<InvalidOperationException>().WithMessage("*payload is invalid*");
    }

    [Fact]
    public async Task ReadAsync_rejects_an_envelope_with_a_missing_update_timestamp()
    {
        var cache = new RecordingCache();
        var envelope = JsonSerializer.SerializeToUtf8Bytes(new
        {
            catalogName = "orders",
            revision = "revision",
            updatedAtUtc = DateTimeOffset.MinValue,
            payload = CatalogJson.Serialize(Document("Orders"))
        });
        cache.Put(DistributedCacheCatalogStore.GetCatalogKey("orders"), envelope);
        var store = CreateStore(cache, CatalogCacheAccessMode.Reader);

        var action = () => store.ReadAsync("orders");

        await action.Should().ThrowAsync<InvalidOperationException>().WithMessage("*payload is incomplete*");
    }

    [Fact]
    public async Task Catalogs_are_isolated_and_round_trip_complete_metadata()
    {
        var store = CreateStore(CatalogCacheAccessMode.SingleWriter);
        var orders = RichDocument("Orders", "OrdersContext");
        var billing = RichDocument("Billing", "BillingContext");

        await store.TryWriteAsync("orders", orders, expectedRevision: null);
        await store.TryWriteAsync("billing", billing, expectedRevision: null);
        var ordersSnapshot = await store.ReadAsync("orders");
        var billingSnapshot = await store.ReadAsync("billing");

        ordersSnapshot!.Document.Features.Should().ContainSingle().Which.Should().BeEquivalentTo(orders.Features[0]);
        ordersSnapshot.Document.Contexts.Should().ContainSingle().Which.Should().BeEquivalentTo(orders.Contexts[0]);
        billingSnapshot!.Document.Features.Should().ContainSingle().Which.Key.Should().Be("Billing");
        billingSnapshot.Document.Contexts.Should().ContainSingle().Which.Kind.Should().Be("BillingContext");
    }

    [Fact]
    public async Task Snapshot_cache_operations_do_not_overwrite_catalog_entries()
    {
        var cache = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
        var store = CreateStore(cache, CatalogCacheAccessMode.SingleWriter);
        await store.TryWriteAsync("orders", Document("Orders"), expectedRevision: null);
        var snapshotProvider = new DistributedCacheFeatureSnapshotProvider(cache, Options.Create(new TogglySnapshotSettings()));

        await snapshotProvider.SaveSnapshotAsync(new FeatureDefinitionsSnapshot { Features = new List<Toggly.FeatureManagement.Data.FeatureDefinitionModel>() });
        var catalog = await store.ReadAsync("orders");

        catalog!.Document.Features.Should().ContainSingle().Which.Key.Should().Be("Orders");
    }

    [Fact]
    public void AddTogglyDistributedCacheCatalogStore_registers_a_single_configured_store()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IDistributedCache>(new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())));

        services.AddTogglyDistributedCacheCatalogStore(options => options.AccessMode = CatalogCacheAccessMode.SingleWriter);
        services.AddTogglyDistributedCacheCatalogStore(options => options.AccessMode = CatalogCacheAccessMode.SingleWriter);
        using var provider = services.BuildServiceProvider();

        provider.GetServices<ITogglyCatalogStore>().Should().ContainSingle().Which.Should().BeOfType<DistributedCacheCatalogStore>();
        provider.GetRequiredService<ITogglyCatalogStore>().Capabilities.SupportsMultipleWriters.Should().BeFalse();
        provider.GetRequiredService<IOptions<TogglyDistributedCacheCatalogOptions>>().Value.AccessMode.Should().Be(CatalogCacheAccessMode.SingleWriter);
    }

    [Fact]
    public void AddTogglyDistributedCacheCatalogStore_rejects_an_unknown_access_mode_when_the_store_is_resolved()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IDistributedCache>(new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())));
        services.AddTogglyDistributedCacheCatalogStore(options => options.AccessMode = (CatalogCacheAccessMode)42);
        using var provider = services.BuildServiceProvider();

        var action = () => provider.GetRequiredService<ITogglyCatalogStore>();

        action.Should().Throw<OptionsValidationException>().WithMessage("*AccessMode is invalid*");
    }

    private static DistributedCacheCatalogStore CreateStore(CatalogCacheAccessMode accessMode) =>
        CreateStore(new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())), accessMode);

    private static DistributedCacheCatalogStore CreateStore(IDistributedCache cache, CatalogCacheAccessMode accessMode) =>
        new(cache, Options.Create(new TogglyDistributedCacheCatalogOptions { AccessMode = accessMode }), new CatalogWriterGate());

    private static CatalogDocument Document(string key) => new()
    {
        Features = new List<CatalogFeature>
        {
            new() { Key = key, Name = key, Description = string.Empty, Enabled = false }
        }
    };

    private static CatalogDocument RichDocument(string key, string contextKind) => new()
    {
        Features = new List<CatalogFeature>
        {
            new()
            {
                Key = key,
                Name = key + " name",
                Description = key + " description",
                Tags = new List<string> { "tag-a", "tag-b" },
                Enabled = true,
                RequirementType = CatalogRequirementType.All,
                ContextKind = contextKind,
                ContextRequirementType = CatalogRequirementType.Any,
                Rules = new List<CatalogRule>
                {
                    new() { Name = "Percentage", Parameters = new Dictionary<string, string> { ["Value"] = "25" } }
                }
            }
        },
        Contexts = new List<CatalogContextSchema>
        {
            new()
            {
                Kind = contextKind,
                KeyPropertyName = "Id",
                Properties = new List<CatalogContextProperty>
                {
                    new() { Name = "Id", Type = "string" },
                    new() { Name = "Region", Type = "string" }
                }
            }
        }
    };

    private sealed class RecordingCache : IDistributedCache
    {
        private readonly Dictionary<string, byte[]> _values = new(StringComparer.Ordinal);

        public Exception? ReadException { get; set; }
        public int SetCalls { get; private set; }
        public DistributedCacheEntryOptions? LastOptions { get; private set; }

        public void Put(string key, byte[] value) => _values[key] = value;

        public byte[]? Get(string key) => throw new NotSupportedException();
        public Task<byte[]?> GetAsync(string key, CancellationToken token = default)
        {
            if (ReadException != null) throw ReadException;
            return Task.FromResult(_values.TryGetValue(key, out var value) ? value : null);
        }

        public void Refresh(string key) => throw new NotSupportedException();
        public Task RefreshAsync(string key, CancellationToken token = default) => throw new NotSupportedException();
        public void Remove(string key) => throw new NotSupportedException();
        public Task RemoveAsync(string key, CancellationToken token = default) => throw new NotSupportedException();
        public void Set(string key, byte[] value, DistributedCacheEntryOptions options) => throw new NotSupportedException();
        public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options, CancellationToken token = default)
        {
            SetCalls++;
            LastOptions = options;
            _values[key] = value;
            return Task.CompletedTask;
        }
    }

    private sealed class BlockingReadCache : IDistributedCache
    {
        private readonly TaskCompletionSource<byte[]?> _firstRead = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private byte[]? _value;

        public int GetCalls { get; private set; }

        public void ReleaseFirstRead() => _firstRead.TrySetResult(null);
        public byte[]? Get(string key) => throw new NotSupportedException();
        public Task<byte[]?> GetAsync(string key, CancellationToken token = default)
        {
            GetCalls++;
            return GetCalls == 1 ? _firstRead.Task : Task.FromResult(_value);
        }

        public void Refresh(string key) => throw new NotSupportedException();
        public Task RefreshAsync(string key, CancellationToken token = default) => throw new NotSupportedException();
        public void Remove(string key) => throw new NotSupportedException();
        public Task RemoveAsync(string key, CancellationToken token = default) => throw new NotSupportedException();
        public void Set(string key, byte[] value, DistributedCacheEntryOptions options) => throw new NotSupportedException();
        public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options, CancellationToken token = default)
        {
            _value = value;
            return Task.CompletedTask;
        }
    }
}
