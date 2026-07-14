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
    public class TogglyMetricsService : IMetricsService, IMetricsDebug, IDisposable
    {
        private readonly string _appKey;

        private readonly string _environment;

        private readonly string _baseUrl;

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        // Multi-variant support: Track metrics per variant name instead of boolean enabled/disabled
        private readonly ConcurrentDictionary<(string MetricKey, string? FeatureKey, string Variant), double> _stats = new ConcurrentDictionary<(string, string?, string), double>();
        
        private readonly ConcurrentDictionary<(string MetricKey, string? FeatureKey, string Variant), double> _counters = new ConcurrentDictionary<(string, string?, string), double>();
        
        private readonly ConcurrentBag<(DateTime Date, string MetricKey, string? FeatureKey, string Variant, double Value)> _observations = new ConcurrentBag<(DateTime, string, string?, string, double)>();

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
        private readonly SemaphoreSlim _sendMetricsSemaphore = new SemaphoreSlim(1, 1);

        private volatile bool _disposed = false;
        private volatile bool _shuttingDown = false;

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

            _timer = new Timer(TimerCallback, null, new TimeSpan(0, 1, 0), new TimeSpan(0, 1, 0));
            applicationLifetime.ApplicationStopping.Register(OnApplicationStopping);

            var version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
            userAgent = $"Toggly.FeatureManagement/{version}";
        }

        private void OnApplicationStopping()
        {
            _shuttingDown = true;
            
            // Stop the timer immediately to prevent new callbacks
            _timer.Change(Timeout.Infinite, Timeout.Infinite);
            
            // Send metrics synchronously during shutdown to avoid async/dispose race conditions
            try
            {
                // Use a synchronous wait with timeout
                var sendTask = SendMetrics(suppressLogging: true);
                sendTask.Wait(TimeSpan.FromSeconds(30));
            }
            catch (AggregateException ae)
            {
                // Swallow exceptions during shutdown - logger may already be disposed
                foreach (var ex in ae.Flatten().InnerExceptions)
                {
                    TryLog(LogLevel.Error, ex, "Error sending metrics during shutdown");
                }
            }
            catch (Exception ex)
            {
                TryLog(LogLevel.Error, ex, "Error sending metrics during shutdown");
            }
        }

        /// <summary>
        /// Safely attempts to log, handling cases where the logger may be disposed
        /// </summary>
        private void TryLog(LogLevel level, string message, params object[] args)
        {
            if (_disposed) return;
            
            try
            {
                _logger.Log(level, message, args);
            }
            catch (ObjectDisposedException)
            {
                // Logger factory was disposed, ignore
            }
        }

        /// <summary>
        /// Safely attempts to log an exception, handling cases where the logger may be disposed
        /// </summary>
        private void TryLog(LogLevel level, Exception? exception, string message, params object[] args)
        {
            if (_disposed) return;
            
            try
            {
                _logger.Log(level, exception, message, args);
            }
            catch (ObjectDisposedException)
            {
                // Logger factory was disposed, ignore
            }
        }

        private volatile string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastSend = null;

        private void TimerCallback(object? state)
        {
            // Skip if shutting down or disposed
            if (_shuttingDown || _disposed) return;
            
            // Fire and forget with proper error handling
            _ = Task.Run(async () =>
            {
                try
                {
                    await SendMetrics().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    TryLog(LogLevel.Error, ex, "Error in timer callback while sending metrics");
                }
            });
        }

        private async Task BeforeSendMetrics()
        {
            var measurements = await _metricsRegistryService.GetMeasurementValuesAsync().ConfigureAwait(false);
            foreach (var m in measurements)
                IncrementMeasurement(m.Key, null, m.Value, true);

            var counters = await _metricsRegistryService.GetCounterValuesAsync().ConfigureAwait(false);
            foreach (var m in counters)
                IncrementMetricCounter(m.Key, null, m.Value, true);

            var observations = await _metricsRegistryService.GetObservationValuesAsync().ConfigureAwait(false);
            foreach (var m in observations)
                StoreObservationInstance(m.Value.Item1, m.Key, null, m.Value.Item2, true);
        }

        private Task SendMetrics() => SendMetrics(suppressLogging: false);

        private async Task SendMetrics(bool suppressLogging)
        {
            // Prevent concurrent send operations (timer and ApplicationStopping could overlap)
            if (!await _sendMetricsSemaphore.WaitAsync(0).ConfigureAwait(false))
            {
                if (!suppressLogging) TryLog(LogLevel.Debug, "SendMetrics already in progress, skipping");
                return;
            }

            try
            {
                await BeforeSendMetrics().ConfigureAwait(false);

                if (_stats.IsEmpty && _counters.IsEmpty && _observations.IsEmpty)
                {
                    if (!suppressLogging) TryLog(LogLevel.Trace, "Send metrics - nothing to send");
                    return;
                }

                if (!suppressLogging) TryLog(LogLevel.Trace, "Sending metrics");
                var currentTime = DateTime.UtcNow;

                
                var dataPacket = new MetricStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Timestamp.FromDateTime(currentTime),
                    InstanceName = appInstanceName
                };

                var statKeys = _stats.Keys
                    .Select(t => (t.MetricKey, t.FeatureKey))
                    .Distinct()
                    .ToList();
                for (int i = 0; i < statKeys.Count; i++)
                {
                    var stat = new MetricStatMessage
                    {
                        Metric = statKeys[i].MetricKey
                    };
                    
                    if (statKeys[i].FeatureKey != null) stat.Feature = statKeys[i].FeatureKey;
                    
                    // Collect all variants for this metric+feature combination
                    var variantsToRemove = _stats.Keys
                        .Where(k => k.MetricKey == statKeys[i].MetricKey && k.FeatureKey == statKeys[i].FeatureKey)
                        .ToList();
                    
                    foreach (var key in variantsToRemove)
                    {
                        if (_stats.TryRemove(key, out var value) && value > 0)
                        {
                            stat.VariantValues[key.Variant] = value;
                        }
                    }
                    
                    // Only add if we have variant values
                    if (stat.VariantValues.Count > 0)
                    {
                        dataPacket.Stats.Add(stat);
                    }
                }

                var counterKeys = _counters.Keys
                    .Select(t => (t.MetricKey, t.FeatureKey))
                    .Distinct()
                    .ToList();
                for (int i = 0; i < counterKeys.Count; i++)
                {
                    var counter = new MetricCounterMessage
                    {
                        Metric = counterKeys[i].MetricKey
                    };

                    if (counterKeys[i].FeatureKey != null) counter.Feature = counterKeys[i].FeatureKey;
                    
                    // Collect all variants for this metric+feature combination
                    var variantsToRemove = _counters.Keys
                        .Where(k => k.MetricKey == counterKeys[i].MetricKey && k.FeatureKey == counterKeys[i].FeatureKey)
                        .ToList();
                    
                    foreach (var key in variantsToRemove)
                    {
                        if (_counters.TryRemove(key, out var value) && value > 0)
                        {
                            counter.VariantValues[key.Variant] = value;
                        }
                    }
                    
                    // Only add if we have variant values
                    if (counter.VariantValues.Count > 0)
                    {
                        dataPacket.Counters.Add(counter);
                    }
                }

                // Group observations by metric+feature+time, then aggregate variants
                var observationGroups = new System.Collections.Generic.Dictionary<(DateTime, string, string?), MetricObservationMessage>();
                
                while (_observations.TryTake(out var observation))
                {
                    var key = (observation.Date, observation.MetricKey, observation.FeatureKey);
                    
                    if (!observationGroups.TryGetValue(key, out var observationMessage))
                    {
                        observationMessage = new MetricObservationMessage
                        {
                            Time = observation.Date.ToTimestamp(),
                            Metric = observation.MetricKey
                        };
                        
                        if (observation.FeatureKey != null) observationMessage.Feature = observation.FeatureKey;
                        observationGroups[key] = observationMessage;
                    }
                    
                    // Add to variant values map
                    observationMessage.VariantValues[observation.Variant] = observation.Value;
                }
                
                dataPacket.Observations.AddRange(observationGroups.Values);

                var grpcMetadata = new Metadata
                {
                    { "UA", userAgent }
                };

                var result = await _metricsClient.SendMetricsAsync(dataPacket, grpcMetadata, DateTime.UtcNow.AddSeconds(180)).ConfigureAwait(false);

                if (result.Count != dataPacket.Stats.Count)
                    if (!suppressLogging) TryLog(LogLevel.Warning, "Metric count did not match. Possible data integrity issues");

                _lastSend = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                if (!suppressLogging) TryLog(LogLevel.Error, ex, "Error sending metrics to toggly");
                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
            }
            finally
            {
                _sendMetricsSemaphore.Release();
            }
        }

        public MetricsDebugInfo GetDebugInfo()
        {
            return new MetricsDebugInfo
            {
                AppKey = AppKeySanitizer.Sanitize(_appKey),
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
            // Map boolean to variant name for backward compatibility
            var variant = enabled ? "enabled" : "disabled";
            IncrementMeasurement(metricKey, featureKey, value, variant);
        }
        
        private void IncrementMeasurement(string metricKey, string? featureKey, double value, string variant)
        {
            // Use AddOrUpdate with lambda for atomic increment - prevents race condition with SendMetrics
            _stats.AddOrUpdate(
                (metricKey, featureKey, variant),
                value, // Add: if key doesn't exist, set to value
                (key, existingValue) => existingValue + value); // Update: if key exists, add value
        }

        /// <inheritdoc/>
        public async Task MeasureAsync(string metricKey, double value)
        {
            TryLog(LogLevel.Trace, "Record feature usage: {metricKey}", metricKey);
            IncrementMeasurement(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMeasurement(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        /// <inheritdoc/>
        public async Task MeasureAsync<TContext>(string metricKey, TContext context, double value)
        {
            TryLog(LogLevel.Trace, "Record feature usage: {metricKey}", metricKey);
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
            // Map boolean to variant name for backward compatibility
            var variant = enabled ? "enabled" : "disabled";
            StoreObservationInstance(date, metricKey, featureKey, value, variant);
        }
        
        private void StoreObservationInstance(DateTime date, string metricKey, string? featureKey, double value, string variant)
        {
            _observations.Add((date, metricKey, featureKey, variant, value));
        }

        /// <inheritdoc/>
        public async Task ObserveAsync(string metricKey, double value)
        {
            var date = DateTime.UtcNow;
            TryLog(LogLevel.Trace, "Record observed value: {metricKey}", metricKey);
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
            TryLog(LogLevel.Trace, "Record observed value: {metricKey}", metricKey);
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
            // Map boolean to variant name for backward compatibility
            var variant = enabled ? "enabled" : "disabled";
            IncrementMetricCounter(metricKey, featureKey, value, variant);
        }
        
        private void IncrementMetricCounter(string metricKey, string? featureKey, double value, string variant)
        {
            // Use AddOrUpdate with lambda for atomic increment - prevents race condition with SendMetrics
            _counters.AddOrUpdate(
                (metricKey, featureKey, variant),
                value, // Add: if key doesn't exist, set to value
                (key, existingValue) => existingValue + value); // Update: if key exists, add value
        }

        /// <inheritdoc/>
        public async Task IncrementCounterAsync(string metricKey, double value)
        {
            TryLog(LogLevel.Trace, "Record feature usage: {metricKey}", metricKey);
            IncrementMetricCounter(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMetricCounter(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature));
        }

        /// <inheritdoc/>
        public async Task IncrementCounterAsync<TContext>(string metricKey, TContext context, double value)
        {
            TryLog(LogLevel.Trace, "Record feature usage: {metricKey}", metricKey);
            IncrementMetricCounter(metricKey, null, value, true);

            var features = _featureExperimentProvider.GetFeaturesForMetric(metricKey);
            if (features != null)
                foreach (var feature in features)
                    IncrementMetricCounter(metricKey, feature, value, await _featureManager.IsEnabledAsync(feature, context));
        }

        #endregion

        #region IDisposable

        /// <summary>
        /// Disposes the metrics service, stopping the timer and releasing resources
        /// </summary>
        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            _shuttingDown = true;

            // Stop the timer
            _timer.Change(Timeout.Infinite, Timeout.Infinite);
            _timer.Dispose();

            // Dispose the semaphore
            _sendMetricsSemaphore.Dispose();

            GC.SuppressFinalize(this);
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
        /// Currently collected stats (multi-variant support)
        /// </summary>
        public ConcurrentDictionary<(string MetricKey, string? FeatureKey, string Variant), double>? Stats { get; set; }

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
