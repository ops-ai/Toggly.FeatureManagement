using Grpc.Net.Client;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Toggly.Web;

namespace Toggly.FeatureManagement
{
    public class TogglyMetricsService : IMetricsService
    {
        private readonly string _appKey;

        private readonly string _environment;

        private readonly string _baseUrl;

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly ConcurrentDictionary<string, int> _stats = new ConcurrentDictionary<string, int>();

        private readonly Timer _timer;

        private readonly IFeatureContextProvider? _contextProvider;

        private readonly string userAgent;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, HashSet<string>> _uniqueUsageMap = new ConcurrentDictionary<string, HashSet<string>>();

        public TogglyMetricsService(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl;
            _clientFactory = clientFactory;
            _contextProvider = (IFeatureContextProvider?)serviceProvider.GetService(typeof(IFeatureContextProvider));

            _logger = loggerFactory.CreateLogger<TogglyUsageStatsProvider>();

            _timer = new Timer((s) => SendMetrics().ConfigureAwait(false), null, new TimeSpan(0, 5, 0), new TimeSpan(0, 5, 0));
            applicationLifetime.ApplicationStopping.Register(() => SendMetrics().ConfigureAwait(false).GetAwaiter().GetResult());

            var version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
            userAgent = $"Toggly.FeatureManagement/{version}";
        }

        private async Task SendMetrics()
        {
            try
            {
                if (_stats.IsEmpty)
                {
                    _logger.LogTrace("Send metrics - nothing to send");
                    return;
                }

                _logger.LogTrace("Sending metrics");
                var currentTime = DateTime.UtcNow;

                using var httpClient = _clientFactory.CreateClient("toggly");
                using var channel = GrpcChannel.ForAddress(_baseUrl, new GrpcChannelOptions { HttpClient = httpClient });
                var client = new Metrics.MetricsClient(channel);
                var dataPacket = new MetricStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(currentTime)
                };

                foreach (var stat in _stats.ToList().GroupBy(t => t.Key[1..]))
                {
                    dataPacket.Stats.Add(new MetricStatMessage
                    {
                        EnabledCount = stat.Any(s => s.Key.StartsWith('a')) ? stat.First(s => s.Key.StartsWith('a')).Value : 0,
                        DisabledCount = stat.Any(s => s.Key.StartsWith('d')) ? stat.First(s => s.Key.StartsWith('d')).Value : 0,
                        Feature = stat.Key,
                        Metric = "" 
                    });
                }

                _stats.Clear();

                var grpcMetadata = new Grpc.Core.Metadata
                {
                    { "UA", userAgent }
                };

                var result = await client.SendMetricsAsync(dataPacket, grpcMetadata).ConfigureAwait(false);

                if (result.Count != dataPacket.Stats.Count)
                    _logger.LogWarning("Metric count did not match. Possible data integrity issues");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending stats to toggly");
            }
        }

        public async Task AddMetricAsync(string metricKey, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd($"v{metricKey}", 0);
            } while (!_stats.TryUpdate($"v{metricKey}", currentValue + value, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(metricKey, new HashSet<string>());
                    currentUniqueValue.Add($"v{uniqueIdentifier}");
                }
            }
        }

        public async Task AddMetricAsync<TContext>(string metricKey, TContext context, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd($"v{metricKey}", 0);
            } while (!_stats.TryUpdate($"v{metricKey}", currentValue + value, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(metricKey, new HashSet<string>());
                    currentUniqueValue.Add($"v{uniqueIdentifier}");
                }
            }
        }
    }
}
