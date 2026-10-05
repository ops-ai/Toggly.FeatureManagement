using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Primitives;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using Moq;
using NSwag;
using NSwag.AspNetCore;
using NSwag.Generation;
using NSwag.Generation.AspNetCore;
using System.Reflection;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.NSwag;
using Xunit;

namespace Toggly.FeatureManagement.NSwag.Tests;

public class OpenApiDocumentMiddlewareTests
{
    private readonly Mock<IApiDescriptionGroupCollectionProvider> _apiExplorerMock;
    private readonly Mock<IOpenApiDocumentGenerator> _documentGeneratorMock;
    private readonly Mock<IFeatureStateService> _featureStateServiceMock;

    public OpenApiDocumentMiddlewareTests()
    {
        _apiExplorerMock = new Mock<IApiDescriptionGroupCollectionProvider>();
        _apiExplorerMock.Setup(x => x.ApiDescriptionGroups)
            .Returns(new ApiDescriptionGroupCollection(new List<ApiDescriptionGroup>(), 1));

        _documentGeneratorMock = new Mock<IOpenApiDocumentGenerator>();
        _documentGeneratorMock.Setup(x => x.GenerateAsync(It.IsAny<string>()))
            .ReturnsAsync(new OpenApiDocument());

        _featureStateServiceMock = new Mock<IFeatureStateService>();
        _featureStateServiceMock.Setup(x => x.WhenDefinitionsChange(It.IsAny<Action>()))
            .Returns(Guid.NewGuid());
    }

    private IServiceProvider CreateServiceProvider(bool includeFeatureStateService = true)
    {
        var serviceProviderMock = new Mock<IServiceProvider>();
        serviceProviderMock.Setup(x => x.GetService(typeof(IApiDescriptionGroupCollectionProvider)))
            .Returns(_apiExplorerMock.Object);
        serviceProviderMock.Setup(x => x.GetService(typeof(IOpenApiDocumentGenerator)))
            .Returns(_documentGeneratorMock.Object);

        if (includeFeatureStateService)
        {
            serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureStateService)))
                .Returns(_featureStateServiceMock.Object);
        }
        else
        {
            serviceProviderMock.Setup(x => x.GetService(typeof(IFeatureStateService)))
                .Returns((IFeatureStateService?)null);
        }

        return serviceProviderMock.Object;
    }

    private static DefaultHttpContext CreateHttpContext(
        IServiceProvider serviceProvider,
        string path = "/swagger/v1/swagger.json",
        string method = "GET")
    {
        var context = new DefaultHttpContext
        {
            RequestServices = serviceProvider
        };
        context.Request.Path = path;
        context.Request.Method = method;
        context.Request.Scheme = "https";
        context.Request.Host = new HostString("localhost", 5000);
        context.Response.Body = new MemoryStream();

        return context;
    }

    #region Constructor Tests

    [Fact]
    public void Constructor_WithValidServiceProvider_InitializesCorrectly()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = _ => Task.CompletedTask;

        // Act
        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        // Assert
        middleware.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_WithoutApiExplorer_ThrowsInvalidOperationException()
    {
        // Arrange
        var serviceProviderMock = new Mock<IServiceProvider>();
        serviceProviderMock.Setup(x => x.GetService(typeof(IApiDescriptionGroupCollectionProvider)))
            .Returns((IApiDescriptionGroupCollectionProvider?)null);

        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        // Act
        var act = () => new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProviderMock.Object,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*API Explorer*");
    }

    [Fact]
    public void Constructor_WithoutFeatureStateService_InitializesCorrectly()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider(includeFeatureStateService: false);
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        // Act
        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        // Assert
        middleware.Should().NotBeNull();
    }

    [Fact]
    public void Constructor_WithPathWithoutLeadingSlash_AddsSlash()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        // Act - path without leading slash
        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "swagger/v1/swagger.json",
            settings);

        // Assert
        middleware.Should().NotBeNull();
    }

    #endregion

    #region Invoke Tests

    [Fact]
    public async Task Invoke_WithNonMatchingPath_CallsNextDelegate()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        bool nextDelegateCalled = false;
        RequestDelegate nextDelegate = (ctx) =>
        {
            nextDelegateCalled = true;
            return Task.CompletedTask;
        };

        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        var context = CreateHttpContext(serviceProvider, "/api/values");

        // Act
        await middleware.Invoke(context);

        // Assert
        nextDelegateCalled.Should().BeTrue();
    }

    [Fact]
    public async Task Invoke_WithMatchingPath_ReturnsJsonDocument()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        bool nextDelegateCalled = false;
        RequestDelegate nextDelegate = (ctx) =>
        {
            nextDelegateCalled = true;
            return Task.CompletedTask;
        };

        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        var context = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.json");

        // Act
        await middleware.Invoke(context);

        // Assert
        nextDelegateCalled.Should().BeFalse();
        context.Response.StatusCode.Should().Be(200);
        context.Response.ContentType.Should().Contain("application/json");
    }

    [Fact]
    public async Task Invoke_WhenRequestIsAborted_CancelsResponseWrite()
    {
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());
        var context = CreateHttpContext(serviceProvider);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        context.RequestAborted = cancellation.Token;

        var act = () => middleware.Invoke(context);

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task Invoke_WithMatchingYamlPath_ReturnsYamlDocument()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.yaml",
            settings);

        var context = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.yaml");

        // Act
        await middleware.Invoke(context);

        // Assert
        context.Response.StatusCode.Should().Be(200);
        context.Response.ContentType.Should().Contain("application/yaml");
    }

    [Fact]
    public async Task Invoke_WithForwardedHeaders_UsesFirstExternalOriginAndPrefix()
    {
        var serviceProvider = CreateServiceProvider();
        var document = new OpenApiDocument();
        _documentGeneratorMock.Setup(x => x.GenerateAsync("v1")).ReturnsAsync(document);
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());
        var context = CreateHttpContext(serviceProvider);
        context.Request.Headers["X-Forwarded-Proto"] = "https,http";
        context.Request.Headers["X-Forwarded-Host"] = "api.example.com,internal";
        context.Request.Headers["X-Forwarded-Prefix"] = "/tenant/,/ignored";

        await middleware.Invoke(context);

        document.Servers.Should().ContainSingle()
            .Which.Url.Should().Be("https://api.example.com/tenant");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Invoke_WithBlankForwardedProtoAndHost_UsesRequestOrigin(string forwardedHeaderValue)
    {
        var serviceProvider = CreateServiceProvider();
        var document = new OpenApiDocument();
        _documentGeneratorMock.Setup(x => x.GenerateAsync("v1")).ReturnsAsync(document);
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());
        var context = CreateHttpContext(serviceProvider);
        context.Request.Headers["X-Forwarded-Proto"] = forwardedHeaderValue;
        context.Request.Headers["X-Forwarded-Host"] = forwardedHeaderValue;

        await middleware.Invoke(context);

        document.Servers.Should().ContainSingle()
            .Which.Url.Should().Be("https://localhost:5000");
    }

    [Fact]
    public async Task Invoke_WithEmptyForwardedHeaderValues_UsesRequestOrigin()
    {
        var serviceProvider = CreateServiceProvider();
        var document = new OpenApiDocument();
        _documentGeneratorMock.Setup(x => x.GenerateAsync("v1")).ReturnsAsync(document);
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());
        var context = CreateHttpContext(serviceProvider);
        context.Request.Headers.TryAdd("X-Forwarded-Proto", StringValues.Empty).Should().BeTrue();
        context.Request.Headers.TryAdd("X-Forwarded-Host", StringValues.Empty).Should().BeTrue();

        await middleware.Invoke(context);

        document.Servers.Should().ContainSingle()
            .Which.Url.Should().Be("https://localhost:5000");
    }

    [Fact]
    public async Task Invoke_WithNullFirstForwardedHeaderValues_UsesRequestOrigin()
    {
        var serviceProvider = CreateServiceProvider();
        var document = new OpenApiDocument();
        _documentGeneratorMock.Setup(x => x.GenerateAsync("v1")).ReturnsAsync(document);
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());
        var context = CreateHttpContext(serviceProvider);
        context.Request.Headers["X-Forwarded-Proto"] = new StringValues(new string?[] { null });
        context.Request.Headers["X-Forwarded-Host"] = new StringValues(new string?[] { null });

        await middleware.Invoke(context);

        document.Servers.Should().ContainSingle()
            .Which.Url.Should().Be("https://localhost:5000");
    }

    [Fact]
    public async Task Invoke_WithCaseInsensitivePath_ReturnsDocument()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        // Path with different case
        var context = CreateHttpContext(serviceProvider, "/SWAGGER/V1/SWAGGER.JSON");

        // Act
        await middleware.Invoke(context);

        // Assert
        context.Response.StatusCode.Should().Be(200);
    }

    #endregion

    #region Caching Tests

    [Fact]
    public async Task Invoke_WithoutExplicitCacheKey_DoesNotReuseGatedDocumentAcrossRequestContexts()
    {
        var accessor = new HttpContextAccessor();
        var apiExplorer = new Mock<IApiDescriptionGroupCollectionProvider>();
        apiExplorer.Setup(x => x.ApiDescriptionGroups)
            .Returns(new ApiDescriptionGroupCollection(new List<ApiDescriptionGroup>(), 1));
        var generator = new Mock<IOpenApiDocumentGenerator>();
        FeatureGateOperationProcessor? processor = null;
        generator.Setup(x => x.GenerateAsync("v1")).ReturnsAsync(() =>
        {
            var document = new OpenApiDocument();
            if (processor!.Process(CreateGatedOperationContext()))
                document.Paths["/gated"] = new OpenApiPathItem();
            return document;
        });
        using var rootServices = new ServiceCollection()
            .AddSingleton<IApiDescriptionGroupCollectionProvider>(apiExplorer.Object)
            .AddSingleton<IOpenApiDocumentGenerator>(generator.Object)
            .AddSingleton<IHttpContextAccessor>(accessor)
            .BuildServiceProvider();
        processor = new FeatureGateOperationProcessor(rootServices);
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, rootServices, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());

        using var enabledServices = CreateGatedRequestServices(rootServices, true);
        var enabled = CreateHttpContext(enabledServices);
        accessor.HttpContext = enabled;
        await middleware.Invoke(enabled);
        using var disabledServices = CreateGatedRequestServices(rootServices, false);
        var disabled = CreateHttpContext(disabledServices);
        accessor.HttpContext = disabled;
        await middleware.Invoke(disabled);

        enabled.Response.Body.Position = 0;
        disabled.Response.Body.Position = 0;
        using var enabledReader = new StreamReader(enabled.Response.Body);
        using var disabledReader = new StreamReader(disabled.Response.Body);
        (await enabledReader.ReadToEndAsync()).Should().Contain("/gated");
        (await disabledReader.ReadToEndAsync()).Should().NotContain("/gated");
        generator.Verify(x => x.GenerateAsync("v1"), Times.Exactly(2));
    }

    private static ServiceProvider CreateGatedRequestServices(IServiceProvider rootServices, bool enabled)
    {
        var snapshot = new Mock<IFeatureManagerSnapshot>();
        snapshot.Setup(x => x.IsEnabledAsync("GatedFeature")).ReturnsAsync(enabled);
        return new ServiceCollection()
            .AddSingleton(snapshot.Object)
            .AddSingleton(rootServices.GetRequiredService<IOpenApiDocumentGenerator>())
            .BuildServiceProvider();
    }

    private static AspNetCoreOperationProcessorContext CreateGatedOperationContext()
    {
        var controllerType = typeof(GatedController);
        var method = controllerType.GetMethod(nameof(GatedController.Action))!;
        return new AspNetCoreOperationProcessorContext(
            new OpenApiDocument(), new OpenApiOperationDescription
            {
                Path = "/gated", Method = "GET", Operation = new OpenApiOperation()
            }, controllerType, method, null!, null!, null!,
            new List<OpenApiOperationDescription>())
        {
            ApiDescription = new ApiDescription
            {
                ActionDescriptor = new ControllerActionDescriptor
                {
                    ControllerTypeInfo = controllerType.GetTypeInfo(),
                    MethodInfo = method
                }
            }
        };
    }

    private sealed class GatedController : ControllerBase
    {
        [FeatureGate("GatedFeature")]
        public OkResult Action() => Ok();
    }

    [Fact]
    public async Task Invoke_ExplicitKeyWithSameVersion_UsesCachedDocument()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings
        {
            CreateDocumentCacheKey = _ => "same-state"
        };
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        var context1 = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.json");
        var context2 = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.json");

        // Act
        await middleware.Invoke(context1);
        await middleware.Invoke(context2);

        // Assert - document generator should only be called once due to caching
        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Once);
    }

    [Fact]
    public async Task Invoke_WithoutExplicitKey_RegeneratesForSameState()
    {
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings());

        await middleware.Invoke(CreateHttpContext(serviceProvider));
        await middleware.Invoke(CreateHttpContext(serviceProvider));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(2));
    }

    [Fact]
    public async Task Invoke_ExplicitEmptyKey_ReusesDocument()
    {
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings { CreateDocumentCacheKey = _ => string.Empty });

        await middleware.Invoke(CreateHttpContext(serviceProvider));
        await middleware.Invoke(CreateHttpContext(serviceProvider));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Once);
    }

    [Fact]
    public async Task Invoke_NullCacheKeyResult_RegeneratesDocument()
    {
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings { CreateDocumentCacheKey = _ => null! });

        await middleware.Invoke(CreateHttpContext(serviceProvider));
        await middleware.Invoke(CreateHttpContext(serviceProvider));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(2));
    }

    [Fact]
    public async Task Invoke_ExplicitKey_VersionChangeOnAnotherKeyDoesNotReuseStaleDocument()
    {
        var version = 1;
        _apiExplorerMock.Setup(x => x.ApiDescriptionGroups)
            .Returns(() => new ApiDescriptionGroupCollection(new List<ApiDescriptionGroup>(), version));
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings
            {
                CreateDocumentCacheKey = request => request.Headers["X-Cache-Key"].ToString()
            });
        var first = CreateHttpContext(serviceProvider);
        first.Request.Headers["X-Cache-Key"] = "first";
        await middleware.Invoke(first);
        version = 2;
        var second = CreateHttpContext(serviceProvider);
        second.Request.Headers["X-Cache-Key"] = "second";
        await middleware.Invoke(second);
        var firstAgain = CreateHttpContext(serviceProvider);
        firstAgain.Request.Headers["X-Cache-Key"] = "first";
        await middleware.Invoke(firstAgain);

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(3));
    }

    [Fact]
    public async Task Invoke_ExplicitHighCardinalityKeys_EvictsOldestEntry()
    {
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings
            {
                CreateDocumentCacheKey = request => request.Headers["X-Cache-Key"].ToString()
            });

        for (var key = 0; key < 33; key++)
        {
            var context = CreateHttpContext(serviceProvider);
            context.Request.Headers["X-Cache-Key"] = key.ToString();
            await middleware.Invoke(context);
        }
        var firstAgain = CreateHttpContext(serviceProvider);
        firstAgain.Request.Headers["X-Cache-Key"] = "0";
        await middleware.Invoke(firstAgain);

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(34));
    }

    [Fact]
    public async Task Invoke_ExplicitKey_DoesNotCacheCanceledGeneration()
    {
        _documentGeneratorMock.SetupSequence(x => x.GenerateAsync("v1"))
            .ThrowsAsync(new OperationCanceledException())
            .ReturnsAsync(new OpenApiDocument());
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings
            {
                CreateDocumentCacheKey = _ => "same-state",
                ExceptionCacheTime = TimeSpan.FromMinutes(1)
            });

        await Assert.ThrowsAsync<OperationCanceledException>(
            () => middleware.Invoke(CreateHttpContext(serviceProvider)));
        await middleware.Invoke(CreateHttpContext(serviceProvider));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(2));
    }

    [Fact]
    public async Task Invoke_AfterDefinitionsChange_RegeneratesDocument()
    {
        Action? onDefinitionsChange = null;
        _featureStateServiceMock.Setup(x => x.WhenDefinitionsChange(It.IsAny<Action>()))
            .Callback<Action>(callback => onDefinitionsChange = callback)
            .Returns(Guid.NewGuid());
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings { CreateDocumentCacheKey = _ => "same-state" });

        await middleware.Invoke(CreateHttpContext(serviceProvider));
        onDefinitionsChange.Should().NotBeNull();
        onDefinitionsChange!();
        await middleware.Invoke(CreateHttpContext(serviceProvider));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(2));
    }

    [Fact]
    public async Task Invoke_DefinitionsChangeDuringGeneration_DoesNotRestoreOldCacheEntry()
    {
        Action? onDefinitionsChange = null;
        _featureStateServiceMock.Setup(x => x.WhenDefinitionsChange(It.IsAny<Action>()))
            .Callback<Action>(callback => onDefinitionsChange = callback)
            .Returns(Guid.NewGuid());
        var firstGeneration = new TaskCompletionSource<OpenApiDocument>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        _documentGeneratorMock.SetupSequence(x => x.GenerateAsync("v1"))
            .Returns(firstGeneration.Task)
            .ReturnsAsync(new OpenApiDocument());
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings { CreateDocumentCacheKey = _ => "same-state" });

        var pendingRequest = middleware.Invoke(CreateHttpContext(serviceProvider));
        onDefinitionsChange.Should().NotBeNull();
        onDefinitionsChange!();
        firstGeneration.SetResult(new OpenApiDocument());
        await pendingRequest;
        await middleware.Invoke(CreateHttpContext(serviceProvider));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Exactly(2));
    }

    [Fact]
    public async Task Invoke_AfterGenerationFailure_ReusesExceptionWithinCacheWindow()
    {
        _documentGeneratorMock.Setup(x => x.GenerateAsync("v1"))
            .ThrowsAsync(new InvalidOperationException("Generation failed"));
        var serviceProvider = CreateServiceProvider();
        var middleware = new OpenApiDocumentMiddleware(
            _ => Task.CompletedTask, serviceProvider, "v1", "/swagger/v1/swagger.json",
            new OpenApiDocumentMiddlewareSettings
            {
                CreateDocumentCacheKey = _ => "same-state",
                ExceptionCacheTime = TimeSpan.FromMinutes(1)
            });

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => middleware.Invoke(CreateHttpContext(serviceProvider)));
        await Assert.ThrowsAsync<InvalidOperationException>(
            () => middleware.Invoke(CreateHttpContext(serviceProvider)));

        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Once);
    }

    #endregion

    #region Feature State Integration Tests

    [Fact]
    public void Constructor_SubscribesToDefinitionsChange()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        // Act
        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        // Assert
        _featureStateServiceMock.Verify(x => x.WhenDefinitionsChange(It.IsAny<Action>()), Times.Once);
    }

    [Fact]
    public void Constructor_WhenSubscriptionFails_DoesNotThrow()
    {
        // Arrange
        _featureStateServiceMock.Setup(x => x.WhenDefinitionsChange(It.IsAny<Action>()))
            .Throws(new Exception("Subscription failed"));

        var serviceProvider = CreateServiceProvider();
        var settings = new OpenApiDocumentMiddlewareSettings();
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        // Act
        var act = () => new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        // Assert
        act.Should().NotThrow();
    }

    #endregion

    #region PostProcess Settings Tests

    [Fact]
    public async Task Invoke_WithPostProcess_CallsPostProcessAction()
    {
        // Arrange
        var serviceProvider = CreateServiceProvider();
        bool postProcessCalled = false;
        var settings = new OpenApiDocumentMiddlewareSettings
        {
            PostProcess = (doc, request) => postProcessCalled = true
        };
        RequestDelegate nextDelegate = (ctx) => Task.CompletedTask;

        var middleware = new OpenApiDocumentMiddleware(
            nextDelegate,
            serviceProvider,
            "v1",
            "/swagger/v1/swagger.json",
            settings);

        var context = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.json");

        // Act
        await middleware.Invoke(context);

        // Assert
        postProcessCalled.Should().BeTrue();
    }

    #endregion
}
