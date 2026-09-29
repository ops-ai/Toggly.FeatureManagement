using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using Moq;
using NSwag;
using NSwag.Generation.AspNetCore;
using System.Reflection;
using Toggly.FeatureManagement.NSwag;
using Xunit;

namespace Toggly.FeatureManagement.NSwag.Tests;

public class FeatureGateOperationProcessorBehaviorTests
{
    [Fact]
    public void Process_UsesRequestSnapshotBeforeRootManager()
    {
        var rootManager = new Mock<IFeatureManager>();
        rootManager.Setup(x => x.IsEnabledAsync("ControllerFeature")).ReturnsAsync(true);
        var requestSnapshot = new Mock<IFeatureManagerSnapshot>();
        requestSnapshot.Setup(x => x.IsEnabledAsync("ControllerFeature")).ReturnsAsync(false);

        using var requestServices = new ServiceCollection()
            .AddSingleton(requestSnapshot.Object)
            .BuildServiceProvider();
        var accessor = new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext { RequestServices = requestServices }
        };
        using var rootServices = new ServiceCollection()
            .AddSingleton<IHttpContextAccessor>(accessor)
            .AddSingleton(rootManager.Object)
            .BuildServiceProvider();

        var processor = new FeatureGateOperationProcessor(rootServices);

        Assert.False(processor.Process(CreateContext(nameof(GatedController.GatedAction))));
    }

    [Fact]
    public void Process_ExcludesActionWhenControllerGateIsEnabledButActionGateIsDisabled()
    {
        var manager = new Mock<IFeatureManager>();
        manager.Setup(x => x.IsEnabledAsync("ControllerFeature")).ReturnsAsync(true);
        manager.Setup(x => x.IsEnabledAsync("ActionFeature")).ReturnsAsync(false);
        using var services = new ServiceCollection()
            .AddSingleton(manager.Object)
            .BuildServiceProvider();

        var processor = new FeatureGateOperationProcessor(services);

        Assert.False(processor.Process(CreateContext(nameof(GatedController.GatedAction))));
    }

    [Fact]
    public void Process_IncludesActionWhenBothControllerAndActionGatesAreEnabled()
    {
        var manager = new Mock<IFeatureManager>();
        manager.Setup(x => x.IsEnabledAsync("ControllerFeature")).ReturnsAsync(true);
        manager.Setup(x => x.IsEnabledAsync("ActionFeature")).ReturnsAsync(true);
        using var services = new ServiceCollection()
            .AddSingleton(manager.Object)
            .BuildServiceProvider();

        var processor = new FeatureGateOperationProcessor(services);

        Assert.True(processor.Process(CreateContext(nameof(GatedController.GatedAction))));
    }

    [Fact]
    public void Process_IncludesGatedActionWhenNoFeatureManagerIsRegistered()
    {
        var processor = new FeatureGateOperationProcessor();

        Assert.True(processor.Process(CreateContext(nameof(GatedController.GatedAction))));
    }

    private static AspNetCoreOperationProcessorContext CreateContext(string actionName)
    {
        var controllerType = typeof(GatedController);
        var method = controllerType.GetMethod(actionName)!;
        var description = new ApiDescription
        {
            ActionDescriptor = new ControllerActionDescriptor
            {
                ControllerTypeInfo = controllerType.GetTypeInfo(),
                MethodInfo = method,
                ControllerName = nameof(GatedController),
                ActionName = actionName
            }
        };
        var operation = new OpenApiOperationDescription
        {
            Path = "/gated",
            Method = "GET",
            Operation = new OpenApiOperation()
        };
        return new AspNetCoreOperationProcessorContext(
            new OpenApiDocument(), operation, controllerType, method,
            null!, null!, null!, new List<OpenApiOperationDescription>())
        {
            ApiDescription = description
        };
    }

    [FeatureGate("ControllerFeature")]
    private sealed class GatedController : ControllerBase
    {
        [FeatureGate("ActionFeature")]
        public OkResult GatedAction() => Ok();
    }
}
