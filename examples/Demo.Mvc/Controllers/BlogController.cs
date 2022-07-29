using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    [FeatureGate(FeatureFlags.Blogs)]
    [FeatureUsage(FeatureFlags.Blogs)]
    public class BlogController : Controller
    {
        private readonly IMetricsService _metricsService;

        public BlogController(IMetricsService metricsService) => _metricsService = metricsService;

        public async Task<IActionResult> Index()
        {
            await _metricsService.AddMetricAsync("Blog Views", 1);
            return View();
        }

        public IActionResult Single()
        {
            return View();
        }
    }
}
