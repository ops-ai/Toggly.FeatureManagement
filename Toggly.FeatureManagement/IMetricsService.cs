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
        Task AddMetricAsync(string metricKey, int value);

        /// <summary>
        /// Increment a value for a defined metric with a specified context
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="metricKey">Name/key of the metric</param>
        /// <param name="context">A custom context</param>
        /// <param name="value">Value to add to the metric</param>
        /// <returns></returns>
        Task AddMetricAsync<TContext>(string metricKey, TContext context, int value);
    }
}
