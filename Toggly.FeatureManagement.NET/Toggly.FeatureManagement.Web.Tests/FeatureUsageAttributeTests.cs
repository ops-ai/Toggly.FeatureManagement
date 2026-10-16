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

public class FeatureUsageAttributeTests
{
    #region Constructor Tests (String Features)

    [Fact]
    public void Constructor_WithStringFeatures_StoresThem()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute("feature1", "feature2");

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "feature1", "feature2" });
    }

    [Fact]
    public void Constructor_WithNullFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute((string[]?)null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithEmptyFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute(Array.Empty<string>());
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithSingleFeature_StoresIt()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute("single-feature");

        // Assert
        attribute.Features.Should().ContainSingle().Which.Should().Be("single-feature");
    }

    #endregion

    #region Constructor Tests (Enum Features)

    [Fact]
    public void Constructor_WithEnumFeatures_ConvertsToStrings()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute(TestFeatures.FeatureA, TestFeatures.FeatureB);

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "FeatureA", "FeatureB" });
    }

    [Fact]
    public void Constructor_WithNonEnumObjects_ThrowsArgumentException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute(123, 456);
        act.Should().Throw<ArgumentException>().WithMessage("*enums*");
    }

    [Fact]
    public void Constructor_WithMixedEnumTypes_ConvertsAll()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute(TestFeatures.FeatureA, OtherFeatures.Beta);

        // Assert
        attribute.Features.Should().BeEquivalentTo(new[] { "FeatureA", "Beta" });
    }

    [Fact]
    public void Constructor_WithNullEnumFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute((object[]?)null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Constructor_WithEmptyEnumFeatures_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new FeatureUsageAttribute(Array.Empty<object>());
        act.Should().Throw<ArgumentNullException>();
    }

    #endregion

    #region RequirementType Tests

    [Fact]
    public void RequirementType_DefaultsToAll()
    {
        // Arrange & Act
        var attribute = new FeatureUsageAttribute("feature");

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.All);
    }

    [Fact]
    public void RequirementType_CanBeSetToAny()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("feature")
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
        var attributeUsage = typeof(FeatureUsageAttribute)
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
        var attributeUsage = typeof(FeatureUsageAttribute)
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
        var attributeUsage = typeof(FeatureUsageAttribute)
            .GetCustomAttributes(typeof(AttributeUsageAttribute), false)
            .Cast<AttributeUsageAttribute>()
            .FirstOrDefault();

        attributeUsage.Should().NotBeNull();
        attributeUsage!.AllowMultiple.Should().BeTrue();
    }

    #endregion

    #region OnActionExecutionAsync Tests

    [Fact]
    public async Task OnActionExecutionAsync_WhenFeatureEnabled_RecordsUsageAndExecutesNext()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature"))
            .ReturnsAsync(true);

        var statsProviderMock = CreateUsageStatsMock();

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
        statsProviderMock.Verify(m => m.BeginUsageAsync("enabled-feature"), Times.Once);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenFeatureDisabled_DoesNotExecuteNextAndInvokesHandler()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("disabled-feature");
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
        statsProviderMock.Verify(m => m.BeginUsageAsync(It.IsAny<string[]>()), Times.Never);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithCustomDisabledFeaturesHandler_InvokesCustomHandler()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("disabled-feature");
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
        var attribute = new FeatureUsageAttribute("feature1", "feature2")
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
        var attribute = new FeatureUsageAttribute("feature1", "feature2")
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
        var attribute = new FeatureUsageAttribute("feature1", "feature2")
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
    public async Task OnActionExecutionAsync_WithMultipleEnabledFeatures_RecordsUsageForAll()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("feature1", "feature2", "feature3");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync(It.IsAny<string>())).ReturnsAsync(true);

        var statsProviderMock = CreateUsageStatsMock();

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
        statsProviderMock.Verify(m => m.BeginUsageAsync("feature1", "feature2", "feature3"), Times.Once);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WithRequirementTypeAll_WhenAllEnabled_RecordsUsage()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("feature1", "feature2")
        {
            RequirementType = RequirementType.All
        };

        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature1")).ReturnsAsync(true);
        featureManagerMock.Setup(m => m.IsEnabledAsync("feature2")).ReturnsAsync(true);

        var statsProviderMock = CreateUsageStatsMock();

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
        statsProviderMock.Verify(m => m.BeginUsageAsync("feature1", "feature2"), Times.Once);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenNextThrows_FailsScopeAndRethrows()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();
        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        var act = () => attribute.OnActionExecutionAsync(actionContext, () =>
            throw new InvalidOperationException("boom"));

        await act.Should().ThrowAsync<InvalidOperationException>();
        scope.Verify(s => s.Fail(), Times.Once);
        scope.Verify(s => s.MarkCancelled(), Times.Never);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenExecutedContextHasException_FailsScope()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();
        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            var executed = new ActionExecutedContext(
                actionContext, new List<IFilterMetadata>(), new object())
            {
                Exception = new InvalidOperationException("stored"),
            };
            return Task.FromResult(executed);
        });

        scope.Verify(s => s.Fail(), Times.Once);
        scope.Verify(s => s.MarkCancelled(), Times.Never);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenExecutedExceptionIsHandled_DoesNotFailScope()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();
        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            var executed = new ActionExecutedContext(
                actionContext, new List<IFilterMetadata>(), new object())
            {
                Exception = new InvalidOperationException("handled"),
                ExceptionHandled = true,
            };
            return Task.FromResult(executed);
        });

        scope.Verify(s => s.Fail(), Times.Never);
        scope.Verify(s => s.MarkCancelled(), Times.Never);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenExecutedContextHasCancellation_MarksCancelled()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();
        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        await attribute.OnActionExecutionAsync(actionContext, () =>
        {
            var executed = new ActionExecutedContext(
                actionContext, new List<IFilterMetadata>(), new object())
            {
                Exception = new OperationCanceledException(),
            };
            return Task.FromResult(executed);
        });

        scope.Verify(s => s.MarkCancelled(), Times.Once);
        scope.Verify(s => s.Fail(), Times.Never);
    }

    [Fact]
    public async Task OnActionExecutionAsync_WhenCancelled_MarksScopeCancelledAndRethrows()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();
        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var actionContext = CreateActionExecutingContext(httpContext);

        var act = () => attribute.OnActionExecutionAsync(actionContext, () =>
            throw new OperationCanceledException());

        await act.Should().ThrowAsync<OperationCanceledException>();
        scope.Verify(s => s.MarkCancelled(), Times.Once);
        scope.Verify(s => s.Fail(), Times.Never);
    }

    [Fact]
    public async Task OnPageHandlerExecutionAsync_WhenFeatureEnabled_RecordsUsageAndExecutesNext()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);
        var statsProviderMock = CreateUsageStatsMock();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var executingContext = new PageHandlerExecutingContext(
            pageContext, new List<IFilterMetadata>(), null, new Dictionary<string, object?>(), new object());
        var nextCalled = false;

        await attribute.OnPageHandlerExecutionAsync(executingContext, () =>
        {
            nextCalled = true;
            return Task.FromResult(new PageHandlerExecutedContext(
                pageContext, new List<IFilterMetadata>(), null, new object()));
        });

        nextCalled.Should().BeTrue();
        statsProviderMock.Verify(m => m.BeginUsageAsync("enabled-feature"), Times.Once);
    }

    [Fact]
    public async Task OnPageHandlerExecutionAsync_WhenFeatureDisabled_SetsNotFoundAndSkipsUsage()
    {
        var attribute = new FeatureUsageAttribute("disabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("disabled-feature")).ReturnsAsync(false);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var executingContext = new PageHandlerExecutingContext(
            pageContext, new List<IFilterMetadata>(), null, new Dictionary<string, object?>(), new object());

        await attribute.OnPageHandlerExecutionAsync(executingContext, () =>
            Task.FromResult(new PageHandlerExecutedContext(
                pageContext, new List<IFilterMetadata>(), null, new object())));

        executingContext.Result.Should().BeOfType<NotFoundResult>();
        statsProviderMock.Verify(m => m.BeginUsageAsync(It.IsAny<string[]>()), Times.Never);
    }

    [Fact]
    public async Task OnPageHandlerExecutionAsync_WhenNextThrows_FailsScopeAndRethrows()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var executingContext = new PageHandlerExecutingContext(
            pageContext, new List<IFilterMetadata>(), null, new Dictionary<string, object?>(), new object());

        var act = () => attribute.OnPageHandlerExecutionAsync(executingContext, () =>
            throw new InvalidOperationException("boom"));

        await act.Should().ThrowAsync<InvalidOperationException>();
        scope.Verify(s => s.Fail(), Times.Once);
        scope.Verify(s => s.MarkCancelled(), Times.Never);
    }

    [Fact]
    public async Task OnPageHandlerExecutionAsync_WhenExecutedContextHasException_FailsScope()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var executingContext = new PageHandlerExecutingContext(
            pageContext, new List<IFilterMetadata>(), null, new Dictionary<string, object?>(), new object());

        await attribute.OnPageHandlerExecutionAsync(executingContext, () =>
        {
            var executed = new PageHandlerExecutedContext(
                pageContext, new List<IFilterMetadata>(), null, new object())
            {
                Exception = new InvalidOperationException("stored"),
            };
            return Task.FromResult(executed);
        });

        scope.Verify(s => s.Fail(), Times.Once);
        scope.Verify(s => s.MarkCancelled(), Times.Never);
    }

    [Fact]
    public async Task OnPageHandlerExecutionAsync_WhenExecutedExceptionIsHandled_DoesNotFailScope()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var executingContext = new PageHandlerExecutingContext(
            pageContext, new List<IFilterMetadata>(), null, new Dictionary<string, object?>(), new object());

        await attribute.OnPageHandlerExecutionAsync(executingContext, () =>
        {
            var executed = new PageHandlerExecutedContext(
                pageContext, new List<IFilterMetadata>(), null, new object())
            {
                Exception = new InvalidOperationException("handled"),
                ExceptionHandled = true,
            };
            return Task.FromResult(executed);
        });

        scope.Verify(s => s.Fail(), Times.Never);
        scope.Verify(s => s.MarkCancelled(), Times.Never);
    }

    [Fact]
    public async Task OnPageHandlerExecutionAsync_WhenCancelled_MarksScopeCancelledAndRethrows()
    {
        var attribute = new FeatureUsageAttribute("enabled-feature");
        var featureManagerMock = new Mock<IFeatureManagerSnapshot>();
        featureManagerMock.Setup(m => m.IsEnabledAsync("enabled-feature")).ReturnsAsync(true);

        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock.Setup(m => m.BeginUsageAsync(It.IsAny<string[]>())).ReturnsAsync(scope.Object);

        var services = new ServiceCollection();
        services.AddSingleton(featureManagerMock.Object);
        services.AddSingleton(statsProviderMock.Object);
        var serviceProvider = services.BuildServiceProvider();

        var httpContext = new DefaultHttpContext { RequestServices = serviceProvider };
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var executingContext = new PageHandlerExecutingContext(
            pageContext, new List<IFilterMetadata>(), null, new Dictionary<string, object?>(), new object());

        var act = () => attribute.OnPageHandlerExecutionAsync(executingContext, () =>
            throw new OperationCanceledException());

        await act.Should().ThrowAsync<OperationCanceledException>();
        scope.Verify(s => s.MarkCancelled(), Times.Once);
        scope.Verify(s => s.Fail(), Times.Never);
    }

    #endregion

    #region OnPageHandlerSelectionAsync Tests

    [Fact]
    public async Task OnPageHandlerSelectionAsync_CompletesImmediately()
    {
        // Arrange
        var attribute = new FeatureUsageAttribute("feature");
        var httpContext = new DefaultHttpContext();
        var pageContext = new PageContext(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));
        var context = new PageHandlerSelectedContext(pageContext, new List<IFilterMetadata>(), new object());

        // Act
        await attribute.OnPageHandlerSelectionAsync(context);

        // Assert - Should complete without throwing
    }

    #endregion

    #region Helper Methods

    private static Mock<IFeatureUsageStatsProvider> CreateUsageStatsMock()
    {
        var scope = new Mock<IFeatureUsageScope>();
        scope.Setup(s => s.DisposeAsync()).Returns(ValueTask.CompletedTask);
        var statsProviderMock = new Mock<IFeatureUsageStatsProvider>();
        statsProviderMock
            .Setup(m => m.BeginUsageAsync(It.IsAny<string[]>()))
            .ReturnsAsync(scope.Object);
        return statsProviderMock;
    }

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
