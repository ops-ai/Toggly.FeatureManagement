using Grpc.Net.Client;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
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

        private readonly ConcurrentDictionary<(string, string?, bool), int> _stats = new ConcurrentDictionary<(string, string?, bool), int>();

        private readonly Timer _timer;

        private readonly string userAgent;

        private readonly IFeatureExperimentProvider _featureExperimentProvider;

        private readonly IFeatureManager _featureManager;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, HashSet<string>> _uniqueUsageMap = new ConcurrentDictionary<string, HashSet<string>>();

        public TogglyMetricsService(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider, IFeatureDefinitionProvider featureDefinitionProvider, IFeatureManager featureManager)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl ?? "https://app.toggly.io/";
            _clientFactory = clientFactory;
            _featureExperimentProvider = (IFeatureExperimentProvider)featureDefinitionProvider;
            _featureManager = featureManager;

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

                var keys = _stats.GroupBy(t => t.Key).ToList();
                for (int i = 0; i < keys.Count; i++)
                {
                    dataPacket.Stats.Add(new MetricStatMessage
                    {
                        EnabledCount = keys[i].Any(s => s.Key.Item3) ? keys[i].First(s => s.Key.Item3).Value : 0,
                        DisabledCount = keys[i].Any(s => !s.Key.Item3) ? keys[i].First(s => !s.Key.Item3).Value : 0,
                        Feature = keys[i].Key.Item2,
                        Metric = keys[i].Key.Item1
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
                _logger.LogError(ex, "Error sending metrics to toggly");
            }
        }

        private void AddMetricValue(string metricKey, string? featureKey, int value, bool enabled)
        {
            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd((metricKey, featureKey, enabled), 0);
            } while (!_stats.TryUpdate((metricKey, featureKey, enabled), currentValue + value, currentValue));

        }

        public async Task AddMetricAsync(string metricKey, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            AddMetricValue(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    AddMetricValue(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        public async Task AddMetricAsync<TContext>(string metricKey, TContext context, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            AddMetricValue(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    AddMetricValue(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature, context));
        }
    }
}
