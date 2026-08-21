using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Filters;

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

        private readonly IFeatureDefinitionModelProvider? _definitions;

        private readonly ITogglyEntityContextResolver? _entityResolver;

        private readonly IFeatureAuthorizationService? _featureAuthorizationService = null;

        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="featureManager"></param>
        /// <param name="featureUsageStatsProvider"></param>
        /// <param name="secureFeatureProvider"></param>
        /// <param name="serviceProvider"></param>
        public TogglyFeatureManager(IFeatureManager featureManager, IFeatureUsageStatsProvider featureUsageStatsProvider, ISecureFeatureProvider secureFeatureProvider, IServiceProvider serviceProvider)
        {
            _featureManager = featureManager;
            _featureUsageStatsProvider = featureUsageStatsProvider;
            _secureFeatureProvider = secureFeatureProvider;
            _definitions = serviceProvider.GetService<IFeatureDefinitionModelProvider>();
            _entityResolver = serviceProvider.GetService<ITogglyEntityContextResolver>();
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
            bool allowed = await EvaluateUserOnlyAsync(feature).ConfigureAwait(false);
            allowed = await ApplySecurityAsync(feature, allowed).ConfigureAwait(false);

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
            bool allowed = await EvaluateWithContextAsync(feature, context).ConfigureAwait(false);
            allowed = await ApplySecurityAsync(feature, allowed).ConfigureAwait(false);

            //Notify usage stats service that it was checked
            await _featureUsageStatsProvider.RecordUsageAsync(feature, context, allowed).ConfigureAwait(false);

            return allowed;
        }

        private async Task<bool> EvaluateUserOnlyAsync(string feature)
        {
            if (TryGetDefinition(feature, out var definition)
                && definition != null
                && ContextPropertyEvaluator.HasEntityFilters(definition))
            {
                return false;
            }

            return await _featureManager.IsEnabledAsync(feature).ConfigureAwait(false);
        }

        private async Task<bool> EvaluateWithContextAsync<TContext>(string feature, TContext context)
        {
            if (!TryGetDefinition(feature, out var definition) || definition == null
                || !ContextPropertyEvaluator.HasEntityFilters(definition))
            {
                return await _featureManager.IsEnabledAsync(feature, context).ConfigureAwait(false);
            }

            if (ContextPropertyEvaluator.HasUserFilters(definition)
                && !await _featureManager.IsEnabledAsync(feature).ConfigureAwait(false))
            {
                return false;
            }

            if (_entityResolver == null || !_entityResolver.TryResolve(context, out var entity) || entity == null)
                return false;

            return ContextPropertyEvaluator.EvaluateEntityFilters(definition, entity);
        }

        private bool TryGetDefinition(string feature, out FeatureDefinitionModel? definition)
        {
            definition = null;
            return _definitions != null && _definitions.TryGetFeatureModel(feature, out definition);
        }

        private async Task<bool> ApplySecurityAsync(string feature, bool allowed)
        {
            if (allowed && _featureAuthorizationService != null && _secureFeatureProvider.IsFeatureSecured(feature))
                allowed = await _featureAuthorizationService.IsAllowedAsync(feature).ConfigureAwait(false);

            return allowed;
        }
    }
}
