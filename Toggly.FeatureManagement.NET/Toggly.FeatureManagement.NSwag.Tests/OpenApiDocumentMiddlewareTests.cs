using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.Extensions.Primitives;
using Moq;
using NSwag;
using NSwag.AspNetCore;
using NSwag.Generation;
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
    public async Task Invoke_SecondRequestWithSameVersion_UsesCachedDocument()
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

        var context1 = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.json");
        var context2 = CreateHttpContext(serviceProvider, "/swagger/v1/swagger.json");

        // Act
        await middleware.Invoke(context1);
        await middleware.Invoke(context2);

        // Assert - document generator should only be called once due to caching
        _documentGeneratorMock.Verify(x => x.GenerateAsync("v1"), Times.Once);
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
            new OpenApiDocumentMiddlewareSettings());

        await middleware.Invoke(CreateHttpContext(serviceProvider));
        onDefinitionsChange.Should().NotBeNull();
        onDefinitionsChange!();
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
            new OpenApiDocumentMiddlewareSettings { ExceptionCacheTime = TimeSpan.FromMinutes(1) });

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
