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

        public IActionResult Index()
        {
            return View();
        }

        public IActionResult Privacy()
        {
            return View();
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult NotFound()
        {
            return View();
        }

        [FeatureGate(FeatureFlags.Team)]
        [FeatureUsage(FeatureFlags.Team)]
        public IActionResult Team()
        {
            return View();
        }

        public IActionResult Career()
        {
            return View();
        }

        [FeatureGate(FeatureFlags.Faqs)]
        [FeatureUsage(FeatureFlags.Faqs)]
        public IActionResult Faq()
        {
            return View();
        }

        public IActionResult About()
        {
            return View();
        }

        [FeatureGate(Microsoft.FeatureManagement.RequirementType.Any, FeatureFlags.ContactAddress,FeatureFlags.ContactForm)]
        public IActionResult Contact()
        {
            return View();
        }
    }
}