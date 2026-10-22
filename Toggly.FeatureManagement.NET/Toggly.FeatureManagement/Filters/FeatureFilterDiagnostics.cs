#nullable enable

using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.FeatureManagement;

namespace Toggly.FeatureManagement.Filters
{
    /// <summary>
    /// Warns once per missing filter referenced by loaded feature definitions.
    /// </summary>
    public sealed class FeatureFilterDiagnostics
    {
        private readonly IFeatureDefinitionProvider _definitionProvider;
        private readonly FeatureFilterRegistrationIndex _registrationIndex;
        private readonly MissingFeatureFilterWarningTracker _warningTracker;

        public FeatureFilterDiagnostics(
            IFeatureDefinitionProvider definitionProvider,
            FeatureFilterRegistrationIndex registrationIndex,
            MissingFeatureFilterWarningTracker warningTracker)
        {
            _definitionProvider = definitionProvider;
            _registrationIndex = registrationIndex;
            _warningTracker = warningTracker;
        }

        /// <summary>
        /// Inspects definition filters and warns for any that are not registered.
        /// </summary>
        public async Task WarnForMissingFiltersOnFeatureAsync(string featureName)
        {
            var definition = await _definitionProvider.GetFeatureDefinitionAsync(featureName).ConfigureAwait(false);
            if (definition?.EnabledFor == null)
                return;

            foreach (var filterName in definition.EnabledFor.Select(f => f.Name).Where(n => !string.IsNullOrEmpty(n)))
            {
                var mapped = TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(filterName);
                _warningTracker.WarnIfMissing(mapped, _registrationIndex);
            }
        }
    }
}
