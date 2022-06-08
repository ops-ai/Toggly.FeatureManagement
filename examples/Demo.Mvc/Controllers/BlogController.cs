using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    [FeatureGate(FeatureFlags.Blogs)]
    [FeatureUsage(FeatureFlags.Faqs)]
    public class BlogController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }

        public IActionResult Single()
        {
            return View();
        }
    }
}
