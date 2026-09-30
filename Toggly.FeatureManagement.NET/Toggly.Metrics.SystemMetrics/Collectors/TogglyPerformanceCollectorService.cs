using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.Diagnostics;
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
        private Guid? taskId;
        private readonly List<EventSource> preConstructorEvents = new List<EventSource>();
        private readonly bool constructed;
        private readonly object _lock = new object();

        private readonly Dictionary<string, double> currentValues = new Dictionary<string, double>();

        /// <summary>
        /// Initializes a collector for the configured runtime event sources.
        /// </summary>
        /// <param name="eventSources">Event sources and their counter-to-metric mappings.</param>
        /// <param name="metricsRegistryService">Registry used to publish collected observations.</param>
        public TogglyPerformanceCollectorService(Dictionary<string, Dictionary<string, string>> eventSources, IMetricsRegistryService metricsRegistryService) : base()
        {
            _eventSources = eventSources;
            _metricsRegistryService = metricsRegistryService;

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

            if (!_eventSources.ContainsKey(eventSource.Name))
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

            foreach (var payload in eventData.Payload)
            {
                if (payload is IDictionary<string, object> eventPayload)
                {
                    var (counterName, counterValue) = GetRelevantMetric(eventPayload);

                    if (_eventSources.TryGetValue(eventData.EventSource.Name, out var sourceMetrics) &&
                        sourceMetrics.TryGetValue(counterName, out var metricName))
                    {
                        lock (_lock)
                        {
                            currentValues[metricName] = counterValue;
                        }
                    }
                }
            }
        }

        private static (string counterName, double counterValue) GetRelevantMetric(IDictionary<string, object> eventPayload)
        {
            var counterName = string.Empty;
            var counterValue = 0d;

            if (eventPayload.TryGetValue("Name", out object displayValue))
            {
                counterName = displayValue.ToString();
            }
            if (eventPayload.TryGetValue("Mean", out object value) ||
                eventPayload.TryGetValue("Increment", out value))
            {
                counterValue = value is double ? (double)value : double.Parse(value.ToString());
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
                    observations.Add(d.Key, (DateTime.UtcNow, d.Value));

                currentValues.Clear();
            }
            return Task.FromResult(observations);
        }
    }
}
