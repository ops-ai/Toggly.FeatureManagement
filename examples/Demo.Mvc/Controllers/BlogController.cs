using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    [FeatureGate(FeatureFlags.Blogs)]
    [FeatureUsage(FeatureFlags.Faqs)]
    [Route("{controller}")]
    public class BlogController : Controller
    {
        [Route("")]
        public IActionResult Index()
        {
            return View();
        }

        [Route("single")]
        public IActionResult Single()
        {
            return View();
        }
    }
}
