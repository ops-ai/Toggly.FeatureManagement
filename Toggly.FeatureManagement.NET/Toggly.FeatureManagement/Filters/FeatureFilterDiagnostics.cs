#nullable enable

using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Warns once per missing filter referenced by loaded feature definitions.
    /// </summary>
    public sealed class FeatureFilterDiagnostics
    {
        private readonly IFeatureDefinitionProvider _definitionProvider;
        private readonly IFeatureDefinitionModelProvider? _modelProvider;
        private readonly FeatureFilterRegistrationIndex _registrationIndex;
        private readonly MissingFeatureFilterWarningTracker _warningTracker;

        public FeatureFilterDiagnostics(
            IFeatureDefinitionProvider definitionProvider,
            FeatureFilterRegistrationIndex registrationIndex,
            MissingFeatureFilterWarningTracker warningTracker,
            IFeatureDefinitionModelProvider? modelProvider = null)
        {
            _definitionProvider = definitionProvider;
            _registrationIndex = registrationIndex;
            _warningTracker = warningTracker;
            _modelProvider = modelProvider;
        }

        /// <summary>
        /// Inspects definition filters and warns for any that are not registered.
        /// </summary>
        public async Task WarnForMissingFiltersOnFeatureAsync(string featureName)
        {
            if (_modelProvider != null
                && _modelProvider.TryGetFeatureModel(featureName, out var model)
                && model != null)
            {
                WarnForMissingFilters(model.Filters);
                return;
            }

            var definition = await _definitionProvider.GetFeatureDefinitionAsync(featureName).ConfigureAwait(false);
            if (definition?.EnabledFor == null)
                return;

            foreach (var filterName in definition.EnabledFor.Select(f => f.Name).Where(n => !string.IsNullOrEmpty(n)))
                WarnMappedFilterName(filterName!);
        }

        private void WarnForMissingFilters(IEnumerable<FeatureFilter>? filters)
        {
            if (filters == null)
                return;

            foreach (var filter in filters)
            {
                if (ContextPropertyEvaluator.IsContextPropertyFilter(filter))
                    continue;

                WarnMappedFilterName(filter.Name);
            }
        }

        private void WarnMappedFilterName(string? filterName)
        {
            var mapped = TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(filterName);
            _warningTracker.WarnIfMissing(mapped, _registrationIndex);
        }
    }
}
