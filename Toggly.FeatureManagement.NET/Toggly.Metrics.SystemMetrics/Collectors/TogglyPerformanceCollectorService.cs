using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Diagnostics.Tracing;
using System.Linq;
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
        private readonly Dictionary<string, Dictionary<string, string>> _eventSources = new Dictionary<string, Dictionary<string, string>>();
        private Guid? taskId;
        private List<EventSource> preConstructorEvents = new List<EventSource>();
        private bool constructed = false;
        private object _lock = new object();

        private Dictionary<string, double> currentValues = new Dictionary<string, double>();

        public TogglyPerformanceCollectorService(Dictionary<string, Dictionary<string, string>> eventSources, IMetricsRegistryService metricsRegistryService) : base()
        {
            _eventSources = eventSources;
            _metricsRegistryService = metricsRegistryService;

            constructed = true;
            preConstructorEvents.ForEach(OnEventSourceCreated);
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            taskId = _metricsRegistryService.RegisterObservations(GetObservations);

            return Task.CompletedTask;
        }
        
        public Task StopAsync(CancellationToken cancellationToken)
        {
            if (taskId.HasValue)
                _metricsRegistryService.UnregisterMetrics(taskId.Value);
            return Task.CompletedTask;
        }

        protected override void OnEventSourceCreated(EventSource source)
        {
            if (!constructed)
            {
                preConstructorEvents.Add(source);
                return;
            }

            if (!_eventSources.Keys.Contains(source.Name))
            {
                return;
            }

            EnableEvents(source, EventLevel.Verbose, EventKeywords.All, new Dictionary<string, string>()
            {
                ["EventCounterIntervalSec"] = "10"
            });
        }

        protected override void OnEventWritten(EventWrittenEventArgs eventData)
        {
            if (!eventData.EventName.Equals("EventCounters"))
                return;

            for (int i = 0; i < eventData.Payload.Count; ++i)
            {
                if (eventData.Payload[i] is IDictionary<string, object> eventPayload)
                {
                    var (counterName, counterValue) = GetRelevantMetric(eventPayload);

                    if (_eventSources.ContainsKey(eventData.EventSource.Name) && _eventSources[eventData.EventSource.Name].ContainsKey(counterName))
                    {
                        if (currentValues.ContainsKey(_eventSources[eventData.EventSource.Name][counterName]))
                            currentValues[_eventSources[eventData.EventSource.Name][counterName]] = counterValue;
                        else
                            currentValues.Add(_eventSources[eventData.EventSource.Name][counterName], counterValue);
                    }
                }
            }
        }

        private static (string counterName, double counterValue) GetRelevantMetric(IDictionary<string, object> eventPayload)
        {
            var counterName = "";
            double counterValue = 0;

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
