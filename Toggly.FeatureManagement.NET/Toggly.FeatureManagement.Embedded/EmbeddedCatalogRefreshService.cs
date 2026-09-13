using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Toggly.FeatureManagement.Embedded;

internal sealed class EmbeddedCatalogRefreshService : BackgroundService
{
    private readonly EmbeddedCatalogCoordinator _coordinator;
    private readonly TogglyEmbeddedOptions _options;
    private readonly IEmbeddedRefreshTimerFactory _timerFactory;
    public EmbeddedCatalogRefreshService(EmbeddedCatalogCoordinator coordinator, IOptions<TogglyEmbeddedOptions> options, IEmbeddedRefreshTimerFactory timerFactory)
    { _coordinator = coordinator; _options = options.Value; _timerFactory = timerFactory; }

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        await _coordinator.RefreshAsync(cancellationToken, _options.InitialLoadTimeout).ConfigureAwait(false);
        await base.StartAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await using var timer = _timerFactory.Create(_options.PollInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            await _coordinator.RefreshAsync(stoppingToken).ConfigureAwait(false);
    }
}
