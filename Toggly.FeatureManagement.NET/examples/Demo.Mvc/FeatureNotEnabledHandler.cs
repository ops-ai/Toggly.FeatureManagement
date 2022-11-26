using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.FeatureManagement.Mvc;

namespace Demo.Mvc
{
    public class FeatureNotEnabledHandler : IDisabledFeaturesHandler
    {
        public Task HandleDisabledFeatures(IEnumerable<string> features, ActionExecutingContext context)
        {
            var result = new ViewResult()
            {
                ViewName = "Views/Shared/FeatureNotEnabled.cshtml",
                ViewData = new ViewDataDictionary(new EmptyModelMetadataProvider(), new ModelStateDictionary())
            };

            result.ViewData["FeatureName"] = string.Join(", ", features);

            if (features.Contains(FeatureFlags.ComingSoon.ToString()))
                context.Result = new RedirectToActionResult("Index", "Home", null);
            else
                context.Result = result;

            return Task.CompletedTask;
        }
    }
}
