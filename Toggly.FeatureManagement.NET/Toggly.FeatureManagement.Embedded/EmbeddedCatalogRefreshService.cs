using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace Toggly.FeatureManagement.Embedded;

internal sealed class EmbeddedCatalogRefreshService : BackgroundService
{
    private readonly EmbeddedCatalogCoordinator _coordinator;
    private readonly TogglyEmbeddedOptions _options;
    public EmbeddedCatalogRefreshService(EmbeddedCatalogCoordinator coordinator, IOptions<TogglyEmbeddedOptions> options) { _coordinator = coordinator; _options = options.Value; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken))
        {
            timeout.CancelAfter(_options.InitialLoadTimeout);
            await _coordinator.RefreshAsync(timeout.Token).ConfigureAwait(false);
        }
        using var timer = new PeriodicTimer(_options.PollInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            await _coordinator.RefreshAsync(stoppingToken).ConfigureAwait(false);
    }
}
