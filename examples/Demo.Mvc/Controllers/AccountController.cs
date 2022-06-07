using Microsoft.AspNetCore.Mvc;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;

namespace Demo.Mvc.Controllers
{
    public class AccountController : Controller
    {
        [Route("sign-in")]
        public IActionResult SignIn()
        {
            return View();
        }

        [Route("sign-up")]
        public IActionResult SignUp()
        {
            return View();
        }
    }
}
