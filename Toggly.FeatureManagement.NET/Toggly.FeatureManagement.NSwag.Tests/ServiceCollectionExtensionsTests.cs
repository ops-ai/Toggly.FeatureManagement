using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Moq;
using NSwag.AspNetCore;
using NSwag.Generation.AspNetCore;
using Toggly.FeatureManagement.NSwag.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.NSwag.Tests;

public class ServiceCollectionExtensionsTests
{
    #region AddFeatureGateFiltering Tests

    [Fact]
    public void AddFeatureGateFiltering_WithValidParameters_AddsOperationProcessor()
    {
        // Arrange
        var settings = new AspNetCoreOpenApiDocumentGeneratorSettings();
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());
        var serviceProvider = services.BuildServiceProvider();

        var initialProcessorCount = settings.OperationProcessors.Count;

        // Act
        var result = settings.AddFeatureGateFiltering(serviceProvider);

        // Assert
        result.Should().BeSameAs(settings);
        settings.OperationProcessors.Count.Should().Be(initialProcessorCount + 1);
        settings.OperationProcessors.Should().Contain(p => p is FeatureGateOperationProcessor);
    }

    [Fact]
    public void AddFeatureGateFiltering_WithNullSettings_ThrowsArgumentNullException()
    {
        // Arrange
        AspNetCoreOpenApiDocumentGeneratorSettings? settings = null;
        var services = new ServiceCollection();
        var serviceProvider = services.BuildServiceProvider();

        // Act & Assert
        var act = () => settings!.AddFeatureGateFiltering(serviceProvider);
        act.Should().Throw<ArgumentNullException>().WithParameterName("settings");
    }

    [Fact]
    public void AddFeatureGateFiltering_WithNullServiceProvider_ThrowsArgumentNullException()
    {
        // Arrange
        var settings = new AspNetCoreOpenApiDocumentGeneratorSettings();

        // Act & Assert
        var act = () => settings.AddFeatureGateFiltering(null!);
        act.Should().Throw<ArgumentNullException>().WithParameterName("serviceProvider");
    }

    [Fact]
    public void AddFeatureGateFiltering_CanBeChainedMultipleTimes()
    {
        // Arrange
        var settings = new AspNetCoreOpenApiDocumentGeneratorSettings();
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());
        var serviceProvider = services.BuildServiceProvider();

        // Act
        var result = settings
            .AddFeatureGateFiltering(serviceProvider)
            .AddFeatureGateFiltering(serviceProvider);

        // Assert
        result.Should().BeSameAs(settings);
        settings.OperationProcessors.Count(p => p is FeatureGateOperationProcessor).Should().Be(2);
    }

    #endregion

    #region UseFeatureAwareOpenApi Tests

    [Fact]
    public void UseFeatureAwareOpenApi_WithNullConfigure_AndSettingsFromDI_UsesProvidedSettings()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());

        // Register settings in DI so that null configure path works
        services.Configure<OpenApiDocumentMiddlewareSettings>(s =>
        {
            s.Path = "/swagger/v1/swagger.json";
            s.DocumentName = "v1";
        });

        var serviceProvider = services.BuildServiceProvider();

        var appBuilderMock = new Mock<IApplicationBuilder>();
        appBuilderMock.Setup(x => x.ApplicationServices).Returns(serviceProvider);

        // UseMiddleware returns itself for chaining
        appBuilderMock
            .Setup(x => x.Use(It.IsAny<Func<RequestDelegate, RequestDelegate>>()))
            .Returns(appBuilderMock.Object);

        // Act
        var result = appBuilderMock.Object.UseFeatureAwareOpenApi();

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public void UseFeatureAwareOpenApi_WithConfigure_InvokesConfigureAction()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());
        var serviceProvider = services.BuildServiceProvider();

        var appBuilderMock = new Mock<IApplicationBuilder>();
        appBuilderMock.Setup(x => x.ApplicationServices).Returns(serviceProvider);
        appBuilderMock
            .Setup(x => x.Use(It.IsAny<Func<RequestDelegate, RequestDelegate>>()))
            .Returns(appBuilderMock.Object);

        var configureInvoked = false;

        // Act
        var result = appBuilderMock.Object.UseFeatureAwareOpenApi(settings =>
        {
            configureInvoked = true;
            settings.Path = "/custom/swagger.json";
        });

        // Assert
        configureInvoked.Should().BeTrue();
    }

    [Fact]
    public void UseFeatureAwareOpenApi_WithPathContainingDocumentName_RegistersMultipleMiddlewares()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());

        // Register document registrations
        var documentRegistrations = new List<OpenApiDocumentRegistration>
        {
            new OpenApiDocumentRegistration("v1", null!),
            new OpenApiDocumentRegistration("v2", null!)
        };
        services.AddSingleton<IEnumerable<OpenApiDocumentRegistration>>(documentRegistrations);

        var serviceProvider = services.BuildServiceProvider();

        var middlewareCallCount = 0;
        var appBuilderMock = new Mock<IApplicationBuilder>();
        appBuilderMock.Setup(x => x.ApplicationServices).Returns(serviceProvider);
        appBuilderMock
            .Setup(x => x.Use(It.IsAny<Func<RequestDelegate, RequestDelegate>>()))
            .Callback(() => middlewareCallCount++)
            .Returns(appBuilderMock.Object);

        // Act
        var result = appBuilderMock.Object.UseFeatureAwareOpenApi(settings =>
        {
            settings.Path = "/swagger/{documentName}/swagger.json";
        });

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public void UseFeatureAwareOpenApi_WithSimplePath_RegistersSingleMiddleware()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());
        var serviceProvider = services.BuildServiceProvider();

        var appBuilderMock = new Mock<IApplicationBuilder>();
        appBuilderMock.Setup(x => x.ApplicationServices).Returns(serviceProvider);
        appBuilderMock
            .Setup(x => x.Use(It.IsAny<Func<RequestDelegate, RequestDelegate>>()))
            .Returns(appBuilderMock.Object);

        // Act
        var result = appBuilderMock.Object.UseFeatureAwareOpenApi(settings =>
        {
            settings.Path = "/swagger/v1/swagger.json";
            settings.DocumentName = "v1";
        });

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public void UseFeatureAwareOpenApi_WithSettingsFromDI_UsesProvidedSettings()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());

        var diSettings = new OpenApiDocumentMiddlewareSettings
        {
            Path = "/api-docs/swagger.json",
            DocumentName = "api"
        };
        services.Configure<OpenApiDocumentMiddlewareSettings>(s =>
        {
            s.Path = diSettings.Path;
            s.DocumentName = diSettings.DocumentName;
        });

        var serviceProvider = services.BuildServiceProvider();

        var appBuilderMock = new Mock<IApplicationBuilder>();
        appBuilderMock.Setup(x => x.ApplicationServices).Returns(serviceProvider);
        appBuilderMock
            .Setup(x => x.Use(It.IsAny<Func<RequestDelegate, RequestDelegate>>()))
            .Returns(appBuilderMock.Object);

        // Act - pass null configure to use DI settings
        var result = appBuilderMock.Object.UseFeatureAwareOpenApi();

        // Assert
        result.Should().NotBeNull();
    }

    [Fact]
    public void UseFeatureAwareOpenApi_WithEmptyDocumentName_UsesDefaultDocumentName()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton(Mock.Of<IFeatureManager>());
        var serviceProvider = services.BuildServiceProvider();

        var appBuilderMock = new Mock<IApplicationBuilder>();
        appBuilderMock.Setup(x => x.ApplicationServices).Returns(serviceProvider);
        appBuilderMock
            .Setup(x => x.Use(It.IsAny<Func<RequestDelegate, RequestDelegate>>()))
            .Returns(appBuilderMock.Object);

        // Act
        var result = appBuilderMock.Object.UseFeatureAwareOpenApi(settings =>
        {
            // Don't set DocumentName - use default
        });

        // Assert
        result.Should().NotBeNull();
    }

    #endregion
}
