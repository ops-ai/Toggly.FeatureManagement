using ConcurrentCollections;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using Grpc.Net.Client;
using Grpc.Net.Client.Configuration;
using Grpc.Net.Client.Web;
using Microsoft.Extensions.DependencyInjection;
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

        private readonly ConcurrentDictionary<(string MetricKey, string? FeatureKey, bool Enabled), double> _stats = new ConcurrentDictionary<(string, string?, bool), double>();
        
        private readonly ConcurrentDictionary<(string MetricKey, string? FeatureKey, bool Enabled), double> _counters = new ConcurrentDictionary<(string, string?, bool), double>();
        
        private readonly ConcurrentBag<(DateTime Date, string MetricKey, string? FeatureKey, bool Enabled, double Value)> _observations = new ConcurrentBag<(DateTime, string, string?, bool, double)>();

        private readonly Timer _timer;

        private readonly string userAgent;

        private readonly IFeatureExperimentProvider _featureExperimentProvider;

        private readonly IFeatureManager _featureManager;

        private readonly IMetricsRegistryService _metricsRegistryService;

        private readonly string? appInstanceName;

        private readonly Metrics.MetricsClient _metricsClient;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<string>> _uniqueUsageMap = new ConcurrentDictionary<string, ConcurrentHashSet<string>>();

        public TogglyMetricsService(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider, IFeatureDefinitionProvider featureDefinitionProvider, IFeatureManager featureManager, Metrics.MetricsClient metricsClient)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl ?? "https://app.toggly.io/";
            _clientFactory = clientFactory;
            _featureExperimentProvider = (IFeatureExperimentProvider)featureDefinitionProvider;
            _featureManager = featureManager;
            _metricsRegistryService = serviceProvider.GetRequiredService<IMetricsRegistryService>();
            appInstanceName = togglySettings.Value.InstanceName ?? Environment.MachineName;
            _metricsClient = metricsClient;

            _logger = loggerFactory.CreateLogger<TogglyMetricsService>();

            _timer = new Timer((s) => SendMetrics().ConfigureAwait(false), null, new TimeSpan(0, 1, 0), new TimeSpan(0, 1, 0));
            applicationLifetime.ApplicationStopping.Register(() => SendMetrics().ConfigureAwait(false).GetAwaiter().GetResult());

            var version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
            userAgent = $"Toggly.FeatureManagement/{version}";
        }

        private string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastSend = null;

        private async Task BeforeSendMetrics()
        {
            var measurements = await _metricsRegistryService.GetMeasurementValuesAsync().ConfigureAwait(false);
            measurements.ToList().ForEach(m => IncrementMeasurement(m.Key, null, m.Value, true));

            var counters = await _metricsRegistryService.GetCounterValuesAsync().ConfigureAwait(false);
            counters.ToList().ForEach(m => IncrementMetricCounter(m.Key, null, m.Value, true));

            var observations = await _metricsRegistryService.GetObservationValuesAsync().ConfigureAwait(false);
            observations.ToList().ForEach(m => StoreObservationInstance(m.Value.Item1, m.Key, null, m.Value.Item2, true));
        }

        private async Task SendMetrics()
        {
            try
            {
                await BeforeSendMetrics().ConfigureAwait(false);

                if (_stats.IsEmpty && _counters.IsEmpty && _observations.IsEmpty)
                {
                    _logger.LogTrace("Send metrics - nothing to send");
                    return;
                }

                _logger.LogTrace("Sending metrics");
                var currentTime = DateTime.UtcNow;

                
                var dataPacket = new MetricStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Timestamp.FromDateTime(currentTime),
                    InstanceName = appInstanceName
                };

                var statKeys = _stats.Keys.Select(t => (t.MetricKey, t.FeatureKey)).ToArray().Distinct().ToArray();
                for (int i = 0; i < statKeys.Length; i++)
                {
                    var stat = new MetricStatMessage
                    {
                        Value = _stats.TryRemove((statKeys[i].MetricKey, statKeys[i].FeatureKey, true), out var enabledCount) ? enabledCount : 0,
                        ValueDisabled = _stats.TryRemove((statKeys[i].MetricKey, statKeys[i].FeatureKey, true), out var disabledCount) ? disabledCount : 0,
                        Metric = statKeys[i].MetricKey
                    };
                    
                    if (statKeys[i].FeatureKey != null) stat.Feature = statKeys[i].FeatureKey;
                    dataPacket.Stats.Add(stat);
                }

                var counterKeys = _counters.Keys.Select(t => (t.MetricKey, t.FeatureKey)).ToArray().Distinct().ToArray();
                for (int i = 0; i < counterKeys.Length; i++)
                {
                    var counter = new MetricCounterMessage
                    {
                        Value = _counters.TryRemove((counterKeys[i].MetricKey, counterKeys[i].FeatureKey, true), out var enabledCount) ? enabledCount : 0,
                        ValueDisabled = _counters.TryRemove((counterKeys[i].MetricKey, counterKeys[i].FeatureKey, true), out var disabledCount) ? disabledCount : 0,
                        Metric = counterKeys[i].MetricKey
                    };

                    if (counterKeys[i].FeatureKey != null) counter.Feature = counterKeys[i].FeatureKey;
                    dataPacket.Counters.Add(counter);
                }

                while (_observations.TryTake(out var observation))
                {
                    var observationMessage = new MetricObservationMessage
                    {
                        Time = observation.Date.ToTimestamp(),
                        Value = observation.Enabled ? observation.Value : 0,
                        ValueDisabled = !observation.Enabled ? observation.Value : 0,
                        Metric = observation.MetricKey
                    };
                    
                    if (observation.FeatureKey != null) observationMessage.Feature = observation.FeatureKey;
                    dataPacket.Observations.Add(observationMessage);
                }

                var grpcMetadata = new Metadata
                {
                    { "UA", userAgent }
                };

                var result = await _metricsClient.SendMetricsAsync(dataPacket, grpcMetadata, DateTime.UtcNow.AddSeconds(180)).ConfigureAwait(false);

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

        /// <inheritdoc/>
        [Obsolete]
        public Task AddMetricAsync(string metricKey, int value)
        {
            return MeasureAsync(metricKey, value);
        }

        /// <inheritdoc/>
        [Obsolete]
        public Task AddMetricAsync<TContext>(string metricKey, TContext context, int value)
        {
            return MeasureAsync(metricKey, context, value);
        }

        private void IncrementMeasurement(string metricKey, string? featureKey, double value, bool enabled)
        {
            double currentValue;
            do
            {
                currentValue = _stats.GetOrAdd((metricKey, featureKey, enabled), 0);
            } while (!_stats.TryUpdate((metricKey, featureKey, enabled), currentValue + value, currentValue));
        }

        /// <inheritdoc/>
        public async Task MeasureAsync(string metricKey, double value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            IncrementMeasurement(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMeasurement(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        /// <inheritdoc/>
        public async Task MeasureAsync<TContext>(string metricKey, TContext context, double value)
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

        private void StoreObservationInstance(DateTime date, string metricKey, string? featureKey, double value, bool enabled)
        {
            _observations.Add((date, metricKey, featureKey, enabled, value));
        }

        /// <inheritdoc/>
        public async Task ObserveAsync(string metricKey, double value)
        {
            var date = DateTime.UtcNow;
            _logger.LogTrace("Record ovserved value: {metricKey}", metricKey);
            StoreObservationInstance(date, metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    StoreObservationInstance(date, metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        /// <inheritdoc/>
        public async Task ObserveAsync<TContext>(string metricKey, TContext context, double value)
        {
            var date = DateTime.UtcNow;
            _logger.LogTrace("Record ovserved value: {metricKey}", metricKey);
            StoreObservationInstance(date, metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    StoreObservationInstance(date, metricKey, feature, value, await _featureManager.IsEnabledAsync(feature, context));
        }

        #endregion


        #region Counters

        private void IncrementMetricCounter(string metricKey, string? featureKey, double value, bool enabled)
        {
            double currentValue;
            do
            {
                currentValue = _counters.GetOrAdd((metricKey, featureKey, enabled), 0);
            } while (!_counters.TryUpdate((metricKey, featureKey, enabled), currentValue + value, currentValue));
        }

        /// <inheritdoc/>
        public async Task IncrementCounterAsync(string metricKey, double value)
        {
            _logger.LogTrace("Record feature usage: {metricKey}", metricKey);
            IncrementMetricCounter(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMetricCounter(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        /// <inheritdoc/>
        public async Task IncrementCounterAsync<TContext>(string metricKey, TContext context, double value)
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

    /// <summary>
    /// A class that holds debug information about the metrics client
    /// </summary>
    public class MetricsDebugInfo
    {
        /// <summary>
        /// The app key
        /// </summary>
        public string? AppKey { get; set; }

        /// <summary>
        /// The registered environment
        /// </summary>
        public string? Environment { get; set; }

        /// <summary>
        /// The base url of the toggly instance
        /// </summary>
        public string? BaseUrl { get; set; }

        /// <summary>
        /// Currently collected stats
        /// </summary>
        public ConcurrentDictionary<(string MetricKey, string? FeatureKey, bool Enabled), double>? Stats { get; set; }

        /// <summary>
        /// The user agent
        /// </summary>
        public string? UserAgent { get; set; }

        /// <summary>
        /// The last error encountered
        /// </summary>
        public string? LastError { get; set; }

        /// <summary>
        /// The time of the last error
        /// </summary>
        public DateTime? LastErrorTime { get; set; }

        /// <summary>
        /// The last time metrics were sent successfully
        /// </summary>
        public DateTime? LastSend { get; set; }
    }
}
