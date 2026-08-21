using Microsoft.Extensions.Logging;
using Microsoft.FeatureManagement;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Context;
using Toggly.FeatureManagement.Filters;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Evaluates ContextProperty filters against the entity on a <see cref="TogglyEvaluationContext"/>.
    /// User filters are evaluated separately by Microsoft Feature Management.
    /// </summary>
    [FilterAlias("ContextProperty")]
    public sealed class ContextPropertyFilter : IContextualFeatureFilter<TogglyEvaluationContext>
    {
        private readonly IFeatureDefinitionModelProvider _definitions;
        private readonly ILogger<ContextPropertyFilter> _logger;

        public ContextPropertyFilter(IFeatureDefinitionModelProvider definitions, ILogger<ContextPropertyFilter> logger)
        {
            _definitions = definitions;
            _logger = logger;
        }

        public Task<bool> EvaluateAsync(FeatureFilterEvaluationContext context, TogglyEvaluationContext appContext)
        {
            if (appContext?.Entity == null)
                return Task.FromResult(false);

            if (!_definitions.TryGetFeatureModel(context.FeatureName, out var definition) || definition == null)
            {
                _logger.LogDebug("ContextProperty filter skipped; definition {Feature} not found.", context.FeatureName);
                return Task.FromResult(false);
            }

            var passed = ContextPropertyEvaluator.EvaluateEntityFilters(definition, appContext.Entity);
            return Task.FromResult(passed);
        }
    }
}
