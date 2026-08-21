#nullable enable

using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Web
{
    /// <summary>
    /// Conditionally renders content when a feature flag is enabled.
    /// Targets the <c>&lt;feature&gt;</c> element (Microsoft-compatible
    /// <c>name</c>/<c>names</c>/<c>requirement</c>/<c>negate</c>) plus Toggly
    /// <c>context</c> for entity targeting. Also matches any element carrying a
    /// <c>feature</c> attribute.
    /// </summary>
    /// <remarks>
    /// When both this helper and <c>Microsoft.FeatureManagement.AspNetCore</c>
    /// are registered, add
    /// <c>@removeTagHelper Microsoft.FeatureManagement.AspNetCore.TagHelpers.FeatureTagHelper, Microsoft.FeatureManagement.AspNetCore</c>
    /// so Microsoft's helper does not evaluate <c>&lt;feature&gt;</c> without
    /// <c>context</c>. This helper runs after the default order so it can
    /// restore child content when Microsoft has already suppressed the element.
    /// </remarks>
    [HtmlTargetElement("feature")]
    [HtmlTargetElement(Attributes = "feature")]
    public sealed class FeatureTagHelper : TagHelper
    {
        private readonly IFeatureManager _featureManager;

        public FeatureTagHelper(IFeatureManager featureManager)
        {
            _featureManager = featureManager;
        }

        /// <summary>
        /// Runs after Microsoft's <c>FeatureTagHelper</c> (Order 0) so entity
        /// context can override a user-only evaluation of the same element.
        /// </summary>
        public override int Order => 10;

        /// <summary>Single feature name.</summary>
        public string? Name { get; set; }

        /// <summary>Comma-separated feature names.</summary>
        public string? Names { get; set; }

        /// <summary>Attribute-form flag name: <c>&lt;div feature="X"&gt;</c>.</summary>
        public string? Feature { get; set; }

        /// <summary>Any (default) or All.</summary>
        public string Requirement { get; set; } = "Any";

        /// <summary>When true, renders when the feature is disabled.</summary>
        public bool Negate { get; set; }

        /// <summary>Entity instance for ContextProperty evaluation (Order, Puppy, etc.).</summary>
        public object? Context { get; set; }

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var isFeatureElement = string.Equals(output.TagName, "feature", StringComparison.OrdinalIgnoreCase);

            var featureNames = ParseFeatureNames();
            if (featureNames.Count == 0)
            {
                output.SuppressOutput();
                return;
            }

            var all = string.Equals(Requirement, "All", StringComparison.OrdinalIgnoreCase);
            var enabled = all
                ? await EvaluateAllAsync(featureNames).ConfigureAwait(false)
                : await EvaluateAnyAsync(featureNames).ConfigureAwait(false);

            if (Negate)
                enabled = !enabled;

            if (!enabled)
            {
                output.SuppressOutput();
                return;
            }

            if (isFeatureElement)
                output.TagName = null;

            var childContent = await output.GetChildContentAsync(false).ConfigureAwait(false);
            output.Content.SetHtmlContent(childContent);
        }

        private List<string> ParseFeatureNames()
        {
            if (!string.IsNullOrWhiteSpace(Name))
                return new List<string> { Name.Trim() };

            if (!string.IsNullOrWhiteSpace(Feature))
                return new List<string> { Feature.Trim() };

            if (string.IsNullOrWhiteSpace(Names))
                return new List<string>();

            return Names
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(n => n.Trim())
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .ToList();
        }

        private async Task<bool> EvaluateAnyAsync(IReadOnlyList<string> featureNames)
        {
            foreach (var featureName in featureNames)
            {
                if (await IsFeatureEnabledAsync(featureName).ConfigureAwait(false))
                    return true;
            }

            return false;
        }

        private async Task<bool> EvaluateAllAsync(IReadOnlyList<string> featureNames)
        {
            foreach (var featureName in featureNames)
            {
                if (!await IsFeatureEnabledAsync(featureName).ConfigureAwait(false))
                    return false;
            }

            return true;
        }

        private Task<bool> IsFeatureEnabledAsync(string featureName)
        {
            if (Context != null)
                return _featureManager.IsEnabledAsync(featureName, Context);

            return _featureManager.IsEnabledAsync(featureName);
        }
    }
}
