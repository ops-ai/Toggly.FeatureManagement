using ConcurrentCollections;
using Grpc.Core;
using Grpc.Net.Client;
using Grpc.Net.Client.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Toggly.Web;

namespace Toggly.FeatureManagement
{
    public class TogglyMetricsService : IMetricsService, IMetricsDebug
    {
        private readonly string _appKey;

        private readonly string _environment;

        private readonly string _baseUrl;

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly ConcurrentDictionary<(string MetricKey, string? FeatureKey, bool Enabled), int> _stats = new ConcurrentDictionary<(string, string?, bool), int>();
        
        private readonly ConcurrentDictionary<(string MetricKey, string? FeatureKey, bool Enabled), int> _counters = new ConcurrentDictionary<(string, string?, bool), int>();
        
        private readonly ConcurrentBag<(DateTime date, string MetricKey, string? FeatureKey, bool Enabled, int)> _observations = new ConcurrentBag<(DateTime, string, string?, bool, int)>();

        private readonly Timer _timer;

        private readonly string userAgent;

        private readonly IFeatureExperimentProvider _featureExperimentProvider;

        private readonly IFeatureManager _featureManager;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<string>> _uniqueUsageMap = new ConcurrentDictionary<string, ConcurrentHashSet<string>>();

        public TogglyMetricsService(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider, IFeatureDefinitionProvider featureDefinitionProvider, IFeatureManager featureManager)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl ?? "https://app.toggly.io/";
            _clientFactory = clientFactory;
            _featureExperimentProvider = (IFeatureExperimentProvider)featureDefinitionProvider;
            _featureManager = featureManager;

            _logger = loggerFactory.CreateLogger<TogglyUsageStatsProvider>();

            _timer = new Timer((s) => SendMetrics().ConfigureAwait(false), null, new TimeSpan(0, 1, 0), new TimeSpan(0, 1, 0));
            applicationLifetime.ApplicationStopping.Register(() => SendMetrics().ConfigureAwait(false).GetAwaiter().GetResult());

            var version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
            userAgent = $"Toggly.FeatureManagement/{version}";
        }

        private string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastSend = null;

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

                var defaultMethodConfig = new MethodConfig
                {
                    Names = { MethodName.Default },
                    RetryPolicy = new RetryPolicy
                    {
                        MaxAttempts = 5,
                        InitialBackoff = TimeSpan.FromSeconds(1),
                        MaxBackoff = TimeSpan.FromSeconds(10),
                        BackoffMultiplier = 1.5,
                        RetryableStatusCodes = { StatusCode.Unavailable, StatusCode.DataLoss, StatusCode.Aborted, StatusCode.OutOfRange, StatusCode.Cancelled, StatusCode.DeadlineExceeded }
                    }
                };

                using var httpClient = _clientFactory.CreateClient("toggly");
                using var channel = GrpcChannel.ForAddress(_baseUrl, new GrpcChannelOptions { HttpClient = httpClient, ServiceConfig = new ServiceConfig { MethodConfigs = { defaultMethodConfig } } });
                var client = new Metrics.MetricsClient(channel);
                var dataPacket = new MetricStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(currentTime)
                };

                var statKeys = _stats.Keys.Select(t => (t.MetricKey, t.FeatureKey)).ToArray().Distinct().ToArray();
                for (int i = 0; i < statKeys.Length; i++)
                {
                    var stat = new MetricStatMessage
                    {
                        EnabledCount = 0,
                        DisabledCount = 0,
                        Metric = statKeys[i].MetricKey
                    };

                    if (_stats.TryRemove((statKeys[i].MetricKey, statKeys[i].FeatureKey, true), out var enabledCount))
                        stat.EnabledCount = enabledCount;

                    if (_stats.TryRemove((statKeys[i].MetricKey, statKeys[i].FeatureKey, true), out var disabledCount))
                        stat.DisabledCount = disabledCount;

                    if (statKeys[i].FeatureKey != null) stat.Feature = statKeys[i].FeatureKey;
                    dataPacket.Stats.Add(stat);
                }

                var counterKeys = _counters.Keys.Select(t => (t.MetricKey, t.FeatureKey)).ToArray().Distinct().ToArray();
                for (int i = 0; i < counterKeys.Length; i++)
                {
                    var counter = new MetricCounterMessage
                    {
                        EnabledCount = 0,
                        DisabledCount = 0,
                        Metric = counterKeys[i].MetricKey
                    };

                    if (_counters.TryRemove((counterKeys[i].MetricKey, counterKeys[i].FeatureKey, true), out var enabledCount))
                        counter.EnabledCount = enabledCount;

                    if (_counters.TryRemove((counterKeys[i].MetricKey, counterKeys[i].FeatureKey, true), out var disabledCount))
                        counter.DisabledCount = disabledCount;

                    if (counterKeys[i].FeatureKey != null) counter.Feature = counterKeys[i].FeatureKey;
                    dataPacket.Counters.Add(counter);
                }

                while (_observations.TryTake(out var observation))
                {
                    var observationMessage = new MetricObservationMessage
                    {
                        EnabledCount = _counters.TryGetValue((observation.MetricKey, observation.FeatureKey, true), out var enabledCount) ? enabledCount : 0,
                        DisabledCount = _counters.TryGetValue((observation.MetricKey, observation.FeatureKey, false), out var disabledCount) ? disabledCount : 0,
                        Metric = observation.MetricKey
                    };
                    if (observation.FeatureKey != null) observationMessage.Feature = observation.FeatureKey;
                    dataPacket.Observations.Add(observationMessage);
                }

                var grpcMetadata = new Metadata
                {
                    { "UA", userAgent }
                };

                var result = await client.SendMetricsAsync(dataPacket, grpcMetadata, DateTime.UtcNow.AddSeconds(30)).ConfigureAwait(false);

                if (result.Count != dataPacket.Stats.Count)
                    _logger.LogWarning("Metric count did not match. Possible data integrity issues");

                _lastSend = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending metrics to toggly");
                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
            }
        }

        public MetricsDebugInfo GetDebugInfo()
        {
            return new MetricsDebugInfo
            {
                AppKey = _appKey,
                BaseUrl = _baseUrl,
                Environment = _environment,
                //Stats = _stats,
                UserAgent = userAgent,
                LastError = _lastError,
                LastErrorTime = _lastErrorTime,
                LastSend = _lastSend
            };
        }


        #region Measure

        [Obsolete]
        public Task AddMetricAsync(string metricKey, int value)
        {
            return MeasureAsync(metricKey, value);
        }

        [Obsolete]
        public Task AddMetricAsync<TContext>(string metricKey, TContext context, int value)
        {
            return MeasureAsync(metricKey, context, value);
        }

        private void IncrementMeasurement(string metricKey, string? featureKey, int value, bool enabled)
        {
            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd((metricKey, featureKey, enabled), 0);
            } while (!_stats.TryUpdate((metricKey, featureKey, enabled), currentValue + value, currentValue));
        }

        public async Task MeasureAsync(string metricKey, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            IncrementMeasurement(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMeasurement(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        public async Task MeasureAsync<TContext>(string metricKey, TContext context, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            IncrementMeasurement(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMeasurement(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature, context));
        }

        #endregion


        #region Observe

        private void StoreObservationInstance(string metricKey, string? featureKey, int value, bool enabled)
        {
            _observations.Add((DateTime.UtcNow, metricKey, featureKey, enabled, value));
        }

        public async Task ObserveAsync(string metricKey, int value)
        {
            _logger.LogTrace("Record ovserved value: {metricKey}", metricKey);
            StoreObservationInstance(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    StoreObservationInstance(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        public async Task ObserveAsync<TContext>(string metricKey, TContext context, int value)
        {
            _logger.LogTrace("Record ovserved value: {metricKey}", metricKey);
            StoreObservationInstance(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    StoreObservationInstance(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature, context));
        }

        #endregion


        #region Counters

        private void IncrementMetricCounter(string metricKey, string? featureKey, int value, bool enabled)
        {
            int currentValue;
            do
            {
                currentValue = _counters.GetOrAdd((metricKey, featureKey, enabled), 0);
            } while (!_counters.TryUpdate((metricKey, featureKey, enabled), currentValue + value, currentValue));
        }

        public async Task IncrementCounterAsync(string metricKey, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            IncrementMetricCounter(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMetricCounter(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        public async Task IncrementCounterAsync<TContext>(string metricKey, TContext context, int value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            IncrementMetricCounter(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMetricCounter(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature, context));
        }

        #endregion
    }

    public class MetricsDebugInfo
    {
        public string? AppKey { get; set; }

        public string? Environment { get; set; }

        public string? BaseUrl { get; set; }

        public ConcurrentDictionary<(string MetricKey, string? FeatureKey, bool Enabled), int>? Stats { get; set; }

        public string? UserAgent { get; set; }

        public string? LastError { get; set; }

        public DateTime? LastErrorTime { get; set; }

        public DateTime? LastSend { get; set; }
    }
}
