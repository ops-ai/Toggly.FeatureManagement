using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    [FeatureGate(FeatureFlags.ComingSoon)]
    [FeatureUsage(FeatureFlags.ComingSoon)]
    public class ComingSoonController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
