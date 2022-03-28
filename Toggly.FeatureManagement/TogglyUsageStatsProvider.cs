using Grpc.Net.Client;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Toggly.Web;

namespace Toggly.FeatureManagement
{
    public class TogglyUsageStatsProvider : IFeatureUsageStatsProvider
    {
        private readonly string _appKey;

        private readonly string _environment;

        private readonly string _baseUrl;

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly ConcurrentDictionary<string, int> _stats = new ConcurrentDictionary<string, int>();

        public TogglyUsageStatsProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl;
            _clientFactory = clientFactory;

            _logger = loggerFactory.CreateLogger<TogglyUsageStatsProvider>();

            var timer = new Timer((s) => SendStats().ConfigureAwait(false), null, new TimeSpan(0, 5, 0), new TimeSpan(0, 5, 0));
            applicationLifetime.ApplicationStopping.Register(() => SendStats().ConfigureAwait(false).GetAwaiter().GetResult());
        }

        private async Task SendStats()
        {
            try
            {
                if (_stats.IsEmpty)
                    return;

                var currentTime = DateTime.UtcNow;

                using var httpClient = _clientFactory.CreateClient("toggly");
                using var channel = GrpcChannel.ForAddress(_baseUrl, new GrpcChannelOptions { HttpClient = httpClient });
                var client = new Usage.UsageClient(channel);
                var dataPacket = new FeatureStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(currentTime),
                };

                foreach (var stat in _stats.GroupBy(t => t.Key[2..]))
                {
                    dataPacket.Stats.Add(new StatMessage
                    {
                        EnabledCount = stat.Any(s => s.Key.StartsWith('a')) ? stat.First(s => s.Key.StartsWith('a')).Value : 0,
                        DisabledCount = stat.Any(s => s.Key.StartsWith('d')) ? stat.First(s => s.Key.StartsWith('d')).Value : 0,
                        Feature = stat.Key,
                        UniqueContextIdentifierDisabledCount = 0,
                        UniqueContextIdentifierEnabledCount = 0,
                        UniqueRequestDisabledCount = 0,
                        UniqueRequestEnabledCount = 0,
                    });
                }

                _stats.Clear();

                var result = await client.SendStatsAsync(dataPacket);

                if (result.FeatureCount != dataPacket.Stats.Count)
                    _logger.LogWarning("Feature count did not match. Possible data integrity issues");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending stats to toggly");
            }
        }

        public Task RecordUsageAsync(string feature, bool allowed)
        {
            //record stats keyed by feature status

            int currentValue;
            do {
                currentValue = _stats.GetOrAdd(allowed ? $"a-{feature}" : $"d-{feature}", 0);
            } while (!_stats.TryUpdate(allowed ? $"a-{feature}" : $"d-{feature}", currentValue + 1, currentValue));

            return Task.CompletedTask;
        }

        public Task RecordUsageAsync<TContext>(string feature, TContext context, bool allowed)
        {
            //record stats keyed by feature status

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd(allowed ? $"a-{feature}" : $"d-{feature}", 0);
            } while (!_stats.TryUpdate(allowed ? $"a-{feature}" : $"d-{feature}", currentValue + 1, currentValue));

            //TODO: record stats keyed by feature status and context property (ex: username, group, ip address)

            return Task.CompletedTask;
        }
    }
}
