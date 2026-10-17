using System.Collections.Generic;
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
        /// Record a feature being used (e.g., user interacted with the feature)
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

        /// <summary>
        /// Begin a usage scope that records one attempt and, on dispose, success or error duration.
        /// Does not evaluate the feature flag.
        /// </summary>
        /// <param name="featureKeys">One or more feature keys sharing the same clock and outcome</param>
        Task<IFeatureUsageScope> BeginUsageAsync(params string[] featureKeys);

        /// <summary>
        /// Begin a usage scope with context for unique-user tracking on the attempt.
        /// Named distinctly from <see cref="BeginUsageAsync"/> so a string context is not
        /// swallowed by the <c>params string[]</c> overload.
        /// </summary>
        Task<IFeatureUsageScope> BeginUsageWithContextAsync<TContext>(TContext context, params string[] featureKeys);

        /// <summary>
        /// Run <paramref name="action"/> inside a usage scope (attempt, duration, failure propagation).
        /// </summary>
        Task UseAsync(string featureKey, System.Func<Task> action);

        /// <summary>
        /// Run <paramref name="action"/> inside a usage scope with an explicit <see cref="IFeatureUsageScope"/> for <c>Fail()</c>.
        /// </summary>
        Task UseAsync(string featureKey, System.Func<IFeatureUsageScope, Task> action);

        /// <summary>
        /// Record a feature being viewed (e.g., UI component was rendered/displayed to user)
        /// </summary>
        /// <param name="featureKey">Name/key of the feature</param>
        /// <returns></returns>
        Task RecordViewAsync(string featureKey);

        /// <summary>
        /// Record a feature being viewed given a custom context
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="featureKey">Name/key of the feature</param>
        /// <param name="context">A custom context for unique user tracking</param>
        /// <returns></returns>
        Task RecordViewAsync<TContext>(string featureKey, TContext context);

        /// <summary>
        /// Record a definition-refresh cache hit (served local definitions without applying a new revision).
        /// Counted once per refresh attempt outcome — not per <c>IsEnabled</c> evaluation.
        /// </summary>
        void RecordDefinitionCacheHit();

        /// <summary>
        /// Record a definition-refresh cache miss (applied a new revision from HTTP or WebSocket).
        /// Counted once per refresh attempt outcome — not per <c>IsEnabled</c> evaluation.
        /// </summary>
        void RecordDefinitionCacheMiss();
    }
}
