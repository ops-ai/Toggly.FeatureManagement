using Demo.Mvc.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using System.Diagnostics;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;

        public HomeController(ILogger<HomeController> logger)
        {
            _logger = logger;
        }

        [Route("")]
        public IActionResult Index()
        {
            return View();
        }

        [Route("privacy")]
        public IActionResult Privacy()
        {
            return View();
        }

        [Route("error")]
        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }

        [Route("404")]
        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult NotFound()
        {
            return View();
        }

        [Route("team")]
        [FeatureGate(FeatureFlags.Team)]
        [FeatureUsage(FeatureFlags.Team)]
        public IActionResult Team()
        {
            return View();
        }

        [Route("career")]
        public IActionResult Career()
        {
            return View();
        }

        [Route("faq")]
        [FeatureGate(FeatureFlags.Faqs)]
        [FeatureUsage(FeatureFlags.Faqs)]
        public IActionResult Faq()
        {
            return View();
        }

        [Route("about")]
        public IActionResult About()
        {
            return View();
        }

        [Route("contact")]
        [FeatureGate(Microsoft.FeatureManagement.RequirementType.Any, FeatureFlags.ContactAddress,FeatureFlags.ContactForm)]
        public IActionResult Contact()
        {
            return View();
        }
    }
}