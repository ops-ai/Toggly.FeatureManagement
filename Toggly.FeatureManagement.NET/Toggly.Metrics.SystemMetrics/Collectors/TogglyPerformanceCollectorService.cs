using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Diagnostics.Tracing;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement;

namespace Toggly.Metrics.SystemMetrics.Collectors
{
    /// <summary>
    /// Collects data from Performance Counters
    /// </summary>
    public class TogglyPerformanceCollectorService : EventListener, IHostedService
    {
        private readonly IMetricsRegistryService _metricsRegistryService;
        private readonly Dictionary<string, Dictionary<string, string>> _eventSources;
        private readonly ILogger? _logger;
        private Guid? taskId;
        private readonly List<EventSource> preConstructorEvents = new List<EventSource>();
        private readonly bool constructed;
        private readonly object _lock = new object();

        /// <summary>
        /// Pending counter samples keyed by configured metric name.
        /// Stored as a list so a null/unnamed sample can be recorded and skipped without
        /// throwing <see cref="ArgumentNullException"/> from <see cref="Dictionary{TKey,TValue}"/>.
        /// </summary>
        private readonly List<(string? MetricName, double Value)> currentValues = new List<(string?, double)>();

        /// <summary>
        /// Initializes a collector for the configured runtime event sources.
        /// </summary>
        /// <param name="eventSources">Event sources and their counter-to-metric mappings.</param>
        /// <param name="metricsRegistryService">Registry used to publish collected observations.</param>
        public TogglyPerformanceCollectorService(Dictionary<string, Dictionary<string, string>> eventSources, IMetricsRegistryService metricsRegistryService)
            : this(eventSources, metricsRegistryService, loggerFactory: null)
        {
        }

        /// <summary>
        /// Initializes a collector for the configured runtime event sources.
        /// </summary>
        /// <param name="eventSources">Event sources and their counter-to-metric mappings.</param>
        /// <param name="metricsRegistryService">Registry used to publish collected observations.</param>
        /// <param name="loggerFactory">Optional logger factory for Debug diagnostics.</param>
        public TogglyPerformanceCollectorService(
            Dictionary<string, Dictionary<string, string>> eventSources,
            IMetricsRegistryService metricsRegistryService,
            ILoggerFactory? loggerFactory) : base()
        {
            _eventSources = eventSources;
            _metricsRegistryService = metricsRegistryService;
            _logger = loggerFactory?.CreateLogger<TogglyPerformanceCollectorService>();

            constructed = true;
            preConstructorEvents.ForEach(OnEventSourceCreated);
        }

        /// <inheritdoc />
        public Task StartAsync(CancellationToken cancellationToken)
        {
            taskId = _metricsRegistryService.RegisterObservations(GetObservations);

            return Task.CompletedTask;
        }
        
        /// <inheritdoc />
        public Task StopAsync(CancellationToken cancellationToken)
        {
            if (taskId.HasValue)
                _metricsRegistryService.UnregisterMetrics(taskId.Value);
            return Task.CompletedTask;
        }

        /// <inheritdoc />
        protected override void OnEventSourceCreated(EventSource eventSource)
        {
            if (!constructed)
            {
                preConstructorEvents.Add(eventSource);
                return;
            }

            if (string.IsNullOrEmpty(eventSource.Name) || !_eventSources.ContainsKey(eventSource.Name))
            {
                return;
            }

            EnableEvents(eventSource, EventLevel.Verbose, EventKeywords.All, new Dictionary<string, string?>
            {
                ["EventCounterIntervalSec"] = "10"
            });
        }

        /// <inheritdoc />
        protected override void OnEventWritten(EventWrittenEventArgs eventData)
        {
            if (eventData.EventName != "EventCounters" || eventData.Payload is null)
                return;

            var eventSourceName = eventData.EventSource?.Name;
            if (string.IsNullOrEmpty(eventSourceName) ||
                !_eventSources.TryGetValue(eventSourceName, out var sourceMetrics))
            {
                return;
            }

            foreach (var payload in eventData.Payload)
            {
                if (payload is IDictionary<string, object> eventPayload)
                {
                    var (counterName, counterValue) = GetRelevantMetric(eventPayload);

                    if (string.IsNullOrEmpty(counterName))
                    {
                        _logger?.LogDebug("Skipping performance counter event without a counter name from source {EventSource}", eventSourceName);
                        continue;
                    }

                    if (!sourceMetrics.TryGetValue(counterName, out var metricName))
                        continue;

                    if (string.IsNullOrEmpty(metricName))
                    {
                        _logger?.LogDebug(
                            "Skipping performance counter {CounterName} from source {EventSource} because the configured metric name is null or empty",
                            counterName,
                            eventSourceName);
                        continue;
                    }

                    lock (_lock)
                    {
                        UpsertCurrentValue(metricName, counterValue);
                    }
                }
            }
        }

        private void UpsertCurrentValue(string metricName, double counterValue)
        {
            for (var i = 0; i < currentValues.Count; i++)
            {
                if (string.Equals(currentValues[i].MetricName, metricName, StringComparison.Ordinal))
                {
                    currentValues[i] = (metricName, counterValue);
                    return;
                }
            }

            currentValues.Add((metricName, counterValue));
        }

        private static (string? counterName, double counterValue) GetRelevantMetric(IDictionary<string, object> eventPayload)
        {
            string? counterName = null;
            var counterValue = 0d;

            if (eventPayload.TryGetValue("Name", out var displayValue) && displayValue != null)
            {
                counterName = displayValue.ToString();
            }
            if ((eventPayload.TryGetValue("Mean", out var value) ||
                eventPayload.TryGetValue("Increment", out value)) &&
                value != null)
            {
                if (value is double doubleValue)
                    counterValue = doubleValue;
                else
                {
                    var raw = value.ToString();
                    if (!string.IsNullOrEmpty(raw))
                        counterValue = double.Parse(raw);
                }
            }

            return (counterName, counterValue);
        }
        

        /// <summary>
        /// Gets whether this metric is supported on the current system.
        /// </summary>
        public bool IsSupported => true;
        
        /// <summary>
        /// Gets and clears the observations accumulated since the prior call.
        /// </summary>
        public Task<Dictionary<string, (DateTime, double)>> GetObservations()
        {
            var observations = new Dictionary<string, (DateTime, double)>();
            lock (_lock)
            {
                foreach (var d in currentValues)
                {
                    if (string.IsNullOrEmpty(d.MetricName))
                    {
                        _logger?.LogDebug("Skipping performance observation entry without a metric key");
                        continue;
                    }

                    observations[d.MetricName] = (DateTime.UtcNow, d.Value);
                }

                currentValues.Clear();
            }
            return Task.FromResult(observations);
        }

        /// <summary>
        /// Test helper: injects a raw sample, including null metric names, to reproduce null-key handling.
        /// </summary>
        internal void AddObservationSampleForTests(string? metricName, double value)
        {
            lock (_lock)
            {
                currentValues.Add((metricName, value));
            }
        }
    }
}
