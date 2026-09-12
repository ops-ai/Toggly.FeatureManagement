using FluentAssertions;
using Microsoft.Extensions.Options;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Embedded.Tests;

public class EmbeddedCatalogRefreshServiceTests
{
    [Fact]
    public async Task StartAsync_StopsWaitingAtInitialLoadTimeout_WhenStoreIgnoresCancellation()
    {
        var store = new NonCancellingStore();
        var coordinator = new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), new TogglyEmbeddedOptions
        {
            CatalogName = "Orders", InitialLoadTimeout = TimeSpan.FromMilliseconds(25), PollInterval = TimeSpan.FromHours(1)
        });
        var service = new EmbeddedCatalogRefreshService(coordinator, Options.Create(new TogglyEmbeddedOptions
        {
            CatalogName = "Orders", InitialLoadTimeout = TimeSpan.FromMilliseconds(25), PollInterval = TimeSpan.FromHours(1)
        }), new PeriodicEmbeddedRefreshTimerFactory());

        await service.StartAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1));

        coordinator.Diagnostics.StorageState.Should().Be(EmbeddedStorageState.Unavailable);
        await service.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task ExecuteAsync_UsesInjectedTimerToTriggerRefresh()
    {
        var store = new CountingStore();
        var coordinator = new EmbeddedCatalogCoordinator(store, new EmbeddedFeatureProvider(), new TogglyEmbeddedOptions { CatalogName = "Orders", PollInterval = TimeSpan.FromHours(1) });
        var timer = new ManualTimer();
        var service = new EmbeddedCatalogRefreshService(coordinator, Options.Create(new TogglyEmbeddedOptions
        {
            CatalogName = "Orders", InitialLoadTimeout = TimeSpan.FromSeconds(1), PollInterval = TimeSpan.FromHours(1)
        }), new ManualTimerFactory(timer));

        await service.StartAsync(CancellationToken.None);
        store.ReadCount.Should().Be(1);
        await timer.WaitStarted.Task.WaitAsync(TimeSpan.FromSeconds(1));
        timer.Tick();
        await store.SecondRead.Task.WaitAsync(TimeSpan.FromSeconds(1));
        await service.StopAsync(CancellationToken.None);
    }

    private sealed class NonCancellingStore : ITogglyCatalogStore
    {
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => new TaskCompletionSource<CatalogSnapshot?>().Task;
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private sealed class CountingStore : ITogglyCatalogStore
    {
        private int _readCount;
        public int ReadCount => _readCount;
        public TaskCompletionSource SecondRead { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public CatalogStoreCapabilities Capabilities => new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _readCount) == 2) SecondRead.TrySetResult();
            return Task.FromResult<CatalogSnapshot?>(new CatalogSnapshot
            {
                CatalogName = catalogName, Revision = _readCount.ToString(), UpdatedAtUtc = DateTimeOffset.UtcNow,
                Document = new CatalogDocument()
            });
        }
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private sealed class ManualTimerFactory : IEmbeddedRefreshTimerFactory
    {
        private readonly ManualTimer _timer;
        public ManualTimerFactory(ManualTimer timer) => _timer = timer;
        public IEmbeddedRefreshTimer Create(TimeSpan interval) => _timer;
    }

    private sealed class ManualTimer : IEmbeddedRefreshTimer
    {
        private TaskCompletionSource<bool> _next = NewWaiter();
        private TaskCompletionSource<bool>? _awaiting;
        public TaskCompletionSource WaitStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ValueTask<bool> WaitForNextTickAsync(CancellationToken cancellationToken)
        {
            WaitStarted.TrySetResult();
            var waiter = Interlocked.Exchange(ref _next, NewWaiter());
            Volatile.Write(ref _awaiting, waiter);
            return new ValueTask<bool>(waiter.Task.WaitAsync(cancellationToken));
        }
        public void Tick() => Volatile.Read(ref _awaiting)!.TrySetResult(true);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        private static TaskCompletionSource<bool> NewWaiter() => new(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
