using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Toggly.Examples.Mvc.Pages
{
    [FeatureGate("FlagPage")]
    [FeatureUsage("FlagPage")]
    public class FlagFeatureModel : PageModel
    {
        private readonly ILogger<FlagFeatureModel> _logger;

        public FlagFeatureModel(ILogger<FlagFeatureModel> logger)
        {
            _logger = logger;
        }

        public void OnGet()
        {
        }
    }
}