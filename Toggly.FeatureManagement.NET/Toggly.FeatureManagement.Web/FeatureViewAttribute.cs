using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// An attribute that can be placed on MVC controller actions or Razor Page handlers 
    /// to gate access based on feature flags AND record that a feature was viewed.
    /// This combines the behavior of [FeatureGate] with view tracking.
    /// </summary>
    /// <remarks>
    /// If the feature is disabled, the action will not execute and the IDisabledFeaturesHandler will be invoked.
    /// If the feature is enabled, a view event is recorded and the action executes.
    /// </remarks>
    /// <example>
    /// <code>
    /// // Gates on the feature AND records a view when enabled
    /// [FeatureView("new_dashboard")]
    /// public IActionResult Dashboard()
    /// {
    ///     return View();
    /// }
    /// </code>
    /// </example>
    [AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = true)]
    public class FeatureViewAttribute : ActionFilterAttribute, IAsyncPageFilter
    {
        /// <summary>
        /// Creates an attribute that gates on features and records views.
        /// </summary>
        /// <param name="features">The names of the features that the attribute will represent.</param>
        public FeatureViewAttribute(params string[] features)
        {
            if (features == null || features.Length == 0)
                throw new ArgumentNullException(nameof(features));

            Features = features;
        }

        /// <summary>
        /// Creates an attribute that gates on features and records views.
        /// </summary>
        /// <param name="features">A set of enums representing the features that the attribute will represent.</param>
        public FeatureViewAttribute(params object[] features)
        {
            if (features == null || features.Length == 0)
                throw new ArgumentNullException(nameof(features));

            var fs = new List<string>();

            foreach (object feature in features)
            {
                var type = feature.GetType();

                if (!type.IsEnum)
                {
                    throw new ArgumentException("The provided features must be enums.", nameof(features));
                }

                fs.Add(Enum.GetName(feature.GetType(), feature));
            }

            Features = fs;
        }

        /// <summary>
        /// The name of the features that the feature attribute will activate for.
        /// </summary>
        public IEnumerable<string> Features { get; }

        /// <summary>
        /// Controls whether 'All' or 'Any' feature in a list of features should be enabled to pass.
        /// </summary>
        public RequirementType RequirementType { get; set; } = RequirementType.All;

        /// <summary>
        /// Performs controller action pre-processing to gate on features and record views.
        /// </summary>
        /// <param name="context">The context of the MVC action.</param>
        /// <param name="next">The action delegate.</param>
        /// <returns>Returns a task representing the action execution unit of work.</returns>
        public override async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
        {
            var featureManager = context.HttpContext.RequestServices.GetRequiredService<IFeatureManagerSnapshot>();
            
            // Check if features are enabled (same logic as FeatureGateAttribute)
            var isEnabled = await IsEnabledAsync(featureManager).ConfigureAwait(false);
            
            if (!isEnabled)
            {
                // Feature is disabled - invoke the disabled features handler
                var disabledFeaturesHandler = context.HttpContext.RequestServices.GetService<IDisabledFeaturesHandler>()
                    ?? new DefaultDisabledFeaturesHandler();
                
                await disabledFeaturesHandler.HandleDisabledFeatures(Features, context).ConfigureAwait(false);
                return;
            }

            // Feature is enabled - record the view
            var statsProvider = context.HttpContext.RequestServices.GetRequiredService<IFeatureUsageStatsProvider>();
            foreach (var feature in Features)
            {
                await statsProvider.RecordViewAsync(feature).ConfigureAwait(false);
            }

            await next().ConfigureAwait(false);
        }

        /// <summary>
        /// Called asynchronously before the handler method is invoked, after model binding is complete.
        /// Gates on features and records views.
        /// </summary>
        /// <param name="context">The <see cref="PageHandlerExecutingContext"/>.</param>
        /// <param name="next">The <see cref="PageHandlerExecutionDelegate"/>. Invoked to execute the next page filter or the handler method itself.</param>
        /// <returns>A <see cref="Task"/> that on completion indicates the filter has executed.</returns>
        public async Task OnPageHandlerExecutionAsync(PageHandlerExecutingContext context, PageHandlerExecutionDelegate next)
        {
            var featureManager = context.HttpContext.RequestServices.GetRequiredService<IFeatureManagerSnapshot>();
            
            // Check if features are enabled
            var isEnabled = await IsEnabledAsync(featureManager).ConfigureAwait(false);
            
            if (!isEnabled)
            {
                // Feature is disabled - for Razor Pages, we set a 404 result
                context.Result = new Microsoft.AspNetCore.Mvc.NotFoundResult();
                return;
            }

            // Feature is enabled - record the view
            var statsProvider = context.HttpContext.RequestServices.GetRequiredService<IFeatureUsageStatsProvider>();
            foreach (var feature in Features)
            {
                await statsProvider.RecordViewAsync(feature).ConfigureAwait(false);
            }

            await next.Invoke().ConfigureAwait(false);
        }

        /// <summary>
        /// Called asynchronously after the handler method has been selected, but before model binding occurs.
        /// </summary>
        /// <param name="context">The <see cref="PageHandlerSelectedContext"/>.</param>
        /// <returns>A <see cref="Task"/> that on completion indicates the filter has executed.</returns>
        public Task OnPageHandlerSelectionAsync(PageHandlerSelectedContext context) => Task.CompletedTask;

        /// <summary>
        /// Checks if the required features are enabled based on the RequirementType.
        /// </summary>
        private async Task<bool> IsEnabledAsync(IFeatureManager featureManager)
        {
            if (RequirementType == RequirementType.All)
            {
                foreach (var feature in Features)
                {
                    if (!await featureManager.IsEnabledAsync(feature).ConfigureAwait(false))
                    {
                        return false;
                    }
                }
                return true;
            }
            else // RequirementType.Any
            {
                foreach (var feature in Features)
                {
                    if (await featureManager.IsEnabledAsync(feature).ConfigureAwait(false))
                    {
                        return true;
                    }
                }
                return false;
            }
        }
    }

    /// <summary>
    /// Default handler for disabled features - returns a 404 Not Found result.
    /// </summary>
    internal class DefaultDisabledFeaturesHandler : IDisabledFeaturesHandler
    {
        public Task HandleDisabledFeatures(IEnumerable<string> features, ActionExecutingContext context)
        {
            context.Result = new Microsoft.AspNetCore.Mvc.NotFoundResult();
            return Task.CompletedTask;
        }
    }
}
