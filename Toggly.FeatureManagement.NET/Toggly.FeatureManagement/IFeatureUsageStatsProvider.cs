using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IFeatureUsageStatsProvider
    {
        /// <summary>
        /// Record a check for the feature being performed. Automatically done if using the Toggly Feature Manager
        /// </summary>
        /// <param name="featureKey">Name/key of the feature</param>
        /// <param name="allowed">Decision to show feature made</param>
        /// <returns></returns>
        Task RecordCheckAsync(string featureKey, bool allowed);

        /// <summary>
        /// Record a check for the feature being performed with a given context. Automatically done if using the Toggly Feature Manager when a feature check specifies context
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="featureKey">Name/key of the feature</param>
        /// <param name="context">A custom context</param>
        /// <param name="allowed">Decision to show feature made</param>
        /// <returns></returns>
        Task RecordUsageAsync<TContext>(string featureKey, TContext context, bool allowed);

        /// <summary>
        /// Record a feature being used
        /// </summary>
        /// <param name="featureKey">Name/key of the feature</param>
        /// <returns></returns>
        Task RecordUsageAsync(string featureKey);

        /// <summary>
        /// Record a feature being used given a custom context
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="featureKey">Name/key of the feature</param>
        /// <param name="context"></param>
        /// <returns></returns>
        Task RecordUsageAsync<TContext>(string featureKey, TContext context);
    }
}
