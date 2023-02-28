using Microsoft.Extensions.Logging;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public class TogglyMetricsRegistryService : IMetricsRegistryService
    {
        private readonly ConcurrentDictionary<Guid, Func<Task<Dictionary<string, double>>>> _measurementHandlers = new ConcurrentDictionary<Guid, Func<Task<Dictionary<string, double>>>>();
        private readonly ConcurrentDictionary<Guid, Func<Task<Dictionary<string, (DateTime, double)>>>> _observationHandlers = new ConcurrentDictionary<Guid, Func<Task<Dictionary<string, (DateTime, double)>>>>();
        private readonly ConcurrentDictionary<Guid, Func<Task<Dictionary<string, double>>>> _counterHandlers = new ConcurrentDictionary<Guid, Func<Task<Dictionary<string, double>>>>();

        private readonly ILogger _logger;

        public TogglyMetricsRegistryService(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<TogglyMetricsRegistryService>();
        }

        /// <inheritdoc/>
        public Guid RegisterMeasurements(Func<Task<Dictionary<string, double>>> action)
        {
            var id = Guid.NewGuid();
            _measurementHandlers.TryAdd(id, action);
            return id;
        }

        /// <inheritdoc/>
        public Guid RegisterObservations(Func<Task<Dictionary<string, (DateTime, double)>>> action)
        {
            var id = Guid.NewGuid();
            _observationHandlers.TryAdd(id, action);
            return id;
        }

        /// <inheritdoc/>
        public Guid RegisterCounters(Func<Task<Dictionary<string, double>>> action)
        {
            var id = Guid.NewGuid();
            _counterHandlers.TryAdd(id, action);
            return id;
        }

        /// <inheritdoc/>
        public bool UnregisterMetrics(Guid id)
        {
            return _measurementHandlers.TryRemove(id, out _) || _observationHandlers.TryRemove(id, out _) || _counterHandlers.TryRemove(id, out _);
        }

        /// <inheritdoc/>
        public async Task<Dictionary<string, double>> GetMeasurementValuesAsync()
        {
            var results = new Dictionary<string, double>();

            foreach (var handler in _measurementHandlers.Values)
            {
                try
                {
                    var handlerResults = await handler().ConfigureAwait(false);
                    foreach (var value in handlerResults)
                    {
                        if (results.ContainsKey(value.Key))
                            results[value.Key] = value.Value;
                        else
                            results.Add(value.Key, value.Value);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error while getting measurement values");
                }
            }

            return results;
        }

        /// <inheritdoc/>
        public async Task<Dictionary<string, (DateTime, double)>> GetObservationValuesAsync()
        {
            var results = new Dictionary<string, (DateTime, double)>();

            foreach (var handler in _observationHandlers.Values)
            {
                try
                {
                    var handlerResults = await handler().ConfigureAwait(false);
                    foreach (var value in handlerResults)
                    {
                        if (results.ContainsKey(value.Key))
                            results[value.Key] = value.Value;
                        else
                            results.Add(value.Key, value.Value);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error while getting observation values");
                }
            }

            return results;
        }

        /// <inheritdoc/>
        public async Task<Dictionary<string, double>> GetCounterValuesAsync()
        {
            var results = new Dictionary<string, double>();

            foreach (var handler in _counterHandlers.Values)
            {
                try
                {
                    var handlerResults = await handler().ConfigureAwait(false);
                    foreach (var value in handlerResults)
                    {
                        if (results.ContainsKey(value.Key))
                            results[value.Key] = value.Value;
                        else
                            results.Add(value.Key, value.Value);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error while getting counter values");
                }
            }

            return results;
        }
    }
}
