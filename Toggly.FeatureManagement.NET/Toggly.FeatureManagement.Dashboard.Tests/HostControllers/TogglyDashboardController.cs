using Microsoft.AspNetCore.Mvc;

namespace ExampleHost.Controllers;

public sealed class TogglyDashboardController : Controller
{
    public IActionResult Index() => Content("host controller");
}
