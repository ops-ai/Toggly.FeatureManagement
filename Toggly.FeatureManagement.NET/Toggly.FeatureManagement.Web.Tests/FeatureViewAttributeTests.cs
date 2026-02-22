using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Moq;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class FeatureViewAttributeTests
{
    #region Constructor Tests (String Features)

    [Fact]
    public void Constructor_WithStringFeatures_StoresThem()
    {
        // Arrange & Act
        var attribute = new FeatureViewAttribute("feature1", "feature2");

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "feature1", "feature2" });
    }

    [Fact]
    public void Constructor_WithNullFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureViewAttribute((string[]?)null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithEmptyFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureViewAttribute(Array.Empty<string>());
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithSingleFeature_StoresIt()
    {
        // Arrange & Act
        var attribute = new FeatureViewAttribute("single-feature");

        // Assert
        attribute.Features.Should().ContainSingle().Which.Should().Be("single-feature");
    }

    #endregion

    #region Constructor Tests (Enum Features)

    [Fact]
    public void Constructor_WithEnumFeatures_ConvertsToStrings()
    {
        // Arrange & Act
        var attribute = new FeatureViewAttribute(TestFeatures.FeatureA, TestFeatures.FeatureB);

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "FeatureA", "FeatureB" });
    }

    [Fact]
    public void Constructor_WithNonEnumObjects_ThrowsArgumentException()
    {
        // Act & Assert
        var act = () => new FeatureViewAttribute(123, 456);
        act.Should().Throw<ArgumentException>().WithMessage("*enums*");
    }

    [Fact]
    public void Constructor_WithMixedEnumTypes_ConvertsAll()
    {
        // Arrange & Act
        var attribute = new FeatureViewAttribute(TestFeatures.FeatureA, OtherFeatures.Beta);

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "FeatureA", "Beta" });
    }

    [Fact]
    public void Constructor_WithNullEnumFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureViewAttribute((object[]?)null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithEmptyEnumFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureViewAttribute(Array.Empty<object>());
        act.Should().Throw<ArgumentNullException>();
    }

    #endregion

    #region RequirementType Tests

    [Fact]
    public void RequirementType_DefaultsToAll()
    {
        // Arrange & Act
        var attribute = new FeatureViewAttribute("feature");

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.All);
    }

    [Fact]
    public void RequirementType_CanBeSetToAny()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("feature")
        {
            // Act
            RequirementType = RequirementType.Any
        };

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.Any);
    }

    #endregion

    #region AttributeUsage Tests

    [Fact]
    public void Attribute_CanBeAppliedToMethods()
    {
        // Arrange & Assert
        var attributeUsage = typeof(FeatureViewAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.ValidOn.Should().HaveFlag(AttributeTargets.Method);
    }

    [Fact]
    public void Attribute_CanBeAppliedToClasses()
    {
        // Arrange & Assert
        var attributeUsage = typeof(FeatureViewAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.ValidOn.Should().HaveFlag(AttributeTargets.Class);
    }

    [Fact]
    public void Attribute_AllowsMultiple()
    {
        // Arrange & Assert
        var attributeUsage = typeof(FeatureViewAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.AllowMultiple.Should().BeTrue();
    }

    #endregion

    #region OnActionExecutionAsync Tests

    [Fact]
    public async Task OnActionExecutionAsync_WhenFeatureEnabled_RecordsViewAndExecutesNext()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature"))
            .ReturnsAsync(true);

        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);
        var nextCalled = false;

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        nextCalled.Should().BeTrue();
        statsProviderMock.Verify(m => m.RecordViewAsync("enabled-feature"), Times.Once);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenFeatureDisabled_DoesNotExecuteNextAndInvokesHandler()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("disabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("disabled-feature"))
            .ReturnsAsync(false);

        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);
        var nextCalled = false;

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        nextCalled.Should().BeFalse();
        actionContext.Result.Should().BeOfType<NotFoundResult>();
        statsProviderMock.Verify(m => m.RecordViewAsync(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithCustomDisabledFeaturesHandler_InvokesCustomHandler()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("disabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("disabled-feature"))
            .ReturnsAsync(false);

        var customHandlerMock = new Mock<IDisabledFeaturesHandler>();
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(customHandlerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        customHandlerMock.Verify(m => m.HandleDisabledFeatures(
            It.Is<IEnumerable<string>>(f => f.Contains("disabled-feature")),
            actionContext), Times.Once);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithRequirementTypeAll_RequiresAllFeaturesEnabled()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("feature1", "feature2")
        {
            RequirementType = RequirementType.All
        };

        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature1")).ReturnsAsync(true);
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature2")).ReturnsAsync(false);

        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);
        var nextCalled = false;

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        nextCalled.Should().BeFalse();
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithRequirementTypeAny_RequiresAnyFeatureEnabled()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("feature1", "feature2")
        {
            RequirementType = RequirementType.Any
        };

        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature1")).ReturnsAsync(false);
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature2")).ReturnsAsync(true);

        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);
        var nextCalled = false;

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        nextCalled.Should().BeTrue();
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithRequirementTypeAny_WhenNoFeaturesEnabled_DoesNotExecuteNext()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("feature1", "feature2")
        {
            RequirementType = RequirementType.Any
        };

        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature1")).ReturnsAsync(false);
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature2")).ReturnsAsync(false);

        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);
        var nextCalled = false;

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            nextCalled = true;
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        nextCalled.Should().BeFalse();
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithMultipleEnabledFeatures_RecordsViewForAll()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("feature1", "feature2", "feature3");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync(It.IsAny<string>())).ReturnsAsync(true);

        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        // Act
        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            return Task.FromResult(new ActionExecutedContext(
                new ActionContext(httpContext, new RouteData(), new ActionDescriptor()),
                new List<IFilterMetadata>(),
                new object()));
        });

        // Assert
        statsProviderMock.Verify(m => m.RecordViewAsync("feature1"), Times.Once);
        statsProviderMock.Verify(m => m.RecordViewAsync("feature2"), Times.Once);
        statsProviderMock.Verify(m => m.RecordViewAsync("feature3"), Times.Once);
    }

    #endregion

    #region OnPageHandlerSelectionAsync Tests

    [Fact]
    public async Task OnPageHandlerSelectionAsync_CompletesImmediately()
    {
        // Arrange
        var attribute = new FeatureViewAttribute("feature");
        var httpContext = new DefaultHttpContext();
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var context = new PageHandlerSelectedContext(pageContext, new List<IFilterMetadata>(), new object());

        // Act
        await attribute.OnPageHandlerSelectionAsync(context);

        // Assert - Should complete without throwing
    }

    #endregion

    #region Helper Methods

    private static ActionExecutingContext CreateActionExecutingContext(HttpContext httpContext)
    {
        var actionContext = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        return new ActionExecutingContext(
            actionContext,
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            new object());
    }

    #endregion

    private enum TestFeatures
    {
        FeatureA,
        FeatureB,
        FeatureC
    }

    private enum OtherFeatures
    {
        Alpha,
        Beta
    }
}
