using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Extended feature manager enabled to record feature check stats and optionally check for security
    /// </summary>
    public class TogglyFeatureManager : IFeatureManager
    {
        private readonly IFeatureManager _featureManager;

        private readonly IFeatureUsageStatsProvider _featureUsageStatsProvider;

        private readonly ISecureFeatureProvider _secureFeatureProvider;

        private readonly IFeatureAuthorizationService? _featureAuthorizationService = null;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="featureManager"></param>
        /// <param name="featureUsageStatsProvider"></param>
        /// <param name="secureFeatureProvider"></param>
        public TogglyFeatureManager(IFeatureManager featureManager, IFeatureUsageStatsProvider featureUsageStatsProvider, ISecureFeatureProvider secureFeatureProvider, IServiceProvider serviceProvider)
        {
            _featureManager = featureManager;
            _featureUsageStatsProvider = featureUsageStatsProvider;
            _secureFeatureProvider = secureFeatureProvider;

            _featureAuthorizationService = serviceProvider.GetService<IFeatureAuthorizationService>();
        }

        /// <summary>
        /// Get feature names
        /// </summary>
        /// <returns></returns>
        public IAsyncEnumerable<string> GetFeatureNamesAsync() => _featureManager.GetFeatureNamesAsync();

        /// <summary>
        /// Check if a feature is enabled
        /// </summary>
        /// <param name="feature"></param>
        /// <returns></returns>
        public async Task<bool> IsEnabledAsync(string feature)
        {
            bool allowed = await _featureManager.IsEnabledAsync(feature).ConfigureAwait(false);

            if (allowed && _featureAuthorizationService != null && _secureFeatureProvider.IsFeatureSecured(feature))
                allowed = await _featureAuthorizationService.IsAllowedAsync(feature).ConfigureAwait(false);

            //Notify usage stats service that it was checked
            await _featureUsageStatsProvider.RecordCheckAsync(feature, allowed).ConfigureAwait(false);

            return allowed;
        }

        /// <summary>
        /// Check if a feature is enabled given a context
        /// </summary>
        /// <typeparam name="TContext"></typeparam>
        /// <param name="feature"></param>
        /// <param name="context"></param>
        /// <returns></returns>
        public async Task<bool> IsEnabledAsync<TContext>(string feature, TContext context)
        {
            bool allowed = await _featureManager.IsEnabledAsync(feature, context).ConfigureAwait(false);

            if (allowed && _featureAuthorizationService != null && _secureFeatureProvider.IsFeatureSecured(feature))
                allowed = await _featureAuthorizationService.IsAllowedAsync(feature).ConfigureAwait(false);

            //Notify usage stats service that it was checked
            await _featureUsageStatsProvider.RecordUsageAsync(feature, context, allowed).ConfigureAwait(false);

            return allowed;
        }
    }
}
