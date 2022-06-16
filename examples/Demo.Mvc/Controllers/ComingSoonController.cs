using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    [FeatureGate(FeatureFlags.ComingSoon)]
    [FeatureUsage(FeatureFlags.ComingSoon)]
    public class ComingSoonController : Controller
    {
        private readonly IMetricsService _metricsService;

        public ComingSoonController(IMetricsService metricsService)
        {
            _metricsService = metricsService;
        }

        public async Task<IActionResult> Index()
        {
            await _metricsService.AddMetricAsync("Coming Soon", 1);
            return View();
        }
    }
}
