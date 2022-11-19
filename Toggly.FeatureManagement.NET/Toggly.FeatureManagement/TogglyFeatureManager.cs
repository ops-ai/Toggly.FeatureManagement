using Microsoft.FeatureManagement;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public class TogglyFeatureManager : IFeatureManager
    {
        private readonly IFeatureManager _featureManager;

        private readonly IFeatureUsageStatsProvider _featureUsageStatsProvider;

        public TogglyFeatureManager(IFeatureManager featureManager, IFeatureUsageStatsProvider featureUsageStatsProvider)
        {
            _featureManager = featureManager;
            _featureUsageStatsProvider = featureUsageStatsProvider;
        }

        public IAsyncEnumerable<string> GetFeatureNamesAsync() => _featureManager.GetFeatureNamesAsync();

        public async Task<bool> IsEnabledAsync(string feature)
        {
            bool allowed = await _featureManager.IsEnabledAsync(feature).ConfigureAwait(false);

            //Notify usage stats service that it was checked
            await _featureUsageStatsProvider.RecordCheckAsync(feature, allowed).ConfigureAwait(false);

            return allowed;
        }

        public async Task<bool> IsEnabledAsync<TContext>(string feature, TContext context)
        {
            bool allowed = await _featureManager.IsEnabledAsync(feature, context).ConfigureAwait(false);

            //Notify usage stats service that it was checked
            await _featureUsageStatsProvider.RecordUsageAsync(feature, context, allowed).ConfigureAwait(false);

            return allowed;
        }
    }
}
