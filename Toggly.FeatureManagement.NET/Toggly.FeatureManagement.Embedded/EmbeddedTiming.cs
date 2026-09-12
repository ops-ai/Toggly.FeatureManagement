namespace Toggly.FeatureManagement.Embedded;

internal interface IEmbeddedClock
{
    DateTimeOffset UtcNow { get; }
}

internal sealed class SystemEmbeddedClock : IEmbeddedClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

internal interface IEmbeddedRefreshTimer : IAsyncDisposable
{
    ValueTask<bool> WaitForNextTickAsync(CancellationToken cancellationToken);
}

internal interface IEmbeddedRefreshTimerFactory
{
    IEmbeddedRefreshTimer Create(TimeSpan interval);
}

internal sealed class PeriodicEmbeddedRefreshTimerFactory : IEmbeddedRefreshTimerFactory
{
    public IEmbeddedRefreshTimer Create(TimeSpan interval) => new PeriodicEmbeddedRefreshTimer(interval);
}

internal sealed class PeriodicEmbeddedRefreshTimer : IEmbeddedRefreshTimer
{
    private readonly PeriodicTimer _timer;
    public PeriodicEmbeddedRefreshTimer(TimeSpan interval) => _timer = new PeriodicTimer(interval);
    public ValueTask<bool> WaitForNextTickAsync(CancellationToken cancellationToken) => _timer.WaitForNextTickAsync(cancellationToken);
    public ValueTask DisposeAsync() { _timer.Dispose(); return ValueTask.CompletedTask; }
}
