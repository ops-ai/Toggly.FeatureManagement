using Microsoft.AspNetCore.Mvc.RazorPages;
using Toggly.FeatureManagement;

namespace Toggly.Examples.Mvc.Pages
{
    public class IndexModel : PageModel
    {
        private readonly ILogger<IndexModel> _logger;
        private readonly IMetricsService _metricsService;

        public IndexModel(ILogger<IndexModel> logger, IMetricsService metricsService)
        {
            _logger = logger;
            _metricsService = metricsService;
        }

        public async Task OnGet()
        {
            await _metricsService.AddMetricAsync("Homepgae", 1);
        }
    }
}