using System;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IMetricsService
    {
        /// <summary>
        /// Increment the value of a defined metric
        /// </summary>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        [Obsolete("Use MeasureAsync instead")]
        Task AddMetricAsync(string metricKey, int value);

        /// <summary>
        /// Increment a value for a defined metric with a specified context
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="context">A custom context</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        [Obsolete("Use MeasureAsync instead")]
        Task AddMetricAsync<TContext>(string metricKey, TContext context, int value);

        /// <summary>
        /// Increment the value of a defined metric
        /// A value that is aggregated over time. This is more akin to the trip odometer on a car, it represents a value over some defined range.
        /// </summary>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="value">Value to add (sum) to the metric</param>
        /// <returns></returns>
        Task MeasureAsync(string metricKey, int value);

        /// <summary>
        /// Increment a value for a defined metric with a specified context
        /// A value that is aggregated over time. This is more akin to the trip odometer on a car, it represents a value over some defined range.
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="context">A custom context</param>
        /// <param name="value">Value to add (sum) to the metric</param>
        /// <returns></returns>
        Task MeasureAsync<TContext>(string metricKey, TContext context, int value);

        /// <summary>
        /// Record a value at an instant in time
        /// Captures the current value at a point in time, like a fuel gauge in a vehicle
        /// </summary>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        Task ObserveAsync(string metricKey, int value);

        /// <summary>
        /// Record a value at an instant in time with a specified context
        /// Captures the current value at a point in time, like a fuel gauge in a vehicle
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="context">A custom context</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        Task ObserveAsync<TContext>(string metricKey, TContext context, int value);

        /// <summary>
        /// Increment a named counter
        /// A value that is summed over time – you can think of this like an odometer on a car
        /// </summary>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        Task IncrementCounterAsync(string metricKey, int value);

        /// <summary>
        /// Increment a named counter with a specified context
        /// A value that is summed over time – you can think of this like an odometer on a car
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="context">A custom context</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        Task IncrementCounterAsync<TContext>(string metricKey, TContext context, int value);
    }
}
