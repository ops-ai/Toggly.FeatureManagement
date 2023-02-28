using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IMetricsRegistryService
    {
        /// <summary>
        /// Register a callback to be executed when measurement metrics are requested which returns a dictionary of measurement values.
        /// </summary>
        /// <param name="action">The callback which returns a dictionary of Metric Keys and values for each</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid RegisterMeasurements(Func<Task<Dictionary<string, double>>> action);

        /// <summary>
        /// Register a callback to be executed when observation metrics are requested which returns a dictionary of observations.
        /// </summary>
        /// <param name="action">The callback which returns a dictionary of Metric Keys and values for each</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid RegisterObservations(Func<Task<Dictionary<string, (DateTime, double)>>> action);

        /// <summary>
        /// Register a callback to be executed when counter metrics are requested which returns a dictionary of counter values.
        /// </summary>
        /// <param name="action">The callback which returns a dictionary of Metric Keys and values for each</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid RegisterCounters(Func<Task<Dictionary<string, double>>> action);

        /// <summary>
        /// Unregister a callback.
        /// </summary>
        /// <param name="id">The ID of the callback</param>
        /// <returns>True if the handler was found and removed</returns>
        bool UnregisterMetrics(Guid id);

        /// <summary>
        /// Get the current measurements
        /// </summary>
        /// <returns></returns>
        Task<Dictionary<string, double>> GetMeasurementValuesAsync();

        /// <summary>
        /// Get the current observations
        /// </summary>
        /// <returns></returns>
        Task<Dictionary<string, (DateTime, double)>> GetObservationValuesAsync();

        /// <summary>
        /// Get the current counters
        /// </summary>
        /// <returns></returns>
        Task<Dictionary<string, double>> GetCounterValuesAsync();
    }
}
