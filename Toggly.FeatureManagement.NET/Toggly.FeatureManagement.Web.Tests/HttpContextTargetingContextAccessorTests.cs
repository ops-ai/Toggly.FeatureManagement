using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Moq;
using System.Security.Claims;
using Toggly.FeatureManagement.Web;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class HttpContextTargetingContextAccessorTests
{
    #region Constructor Tests

    [Fact]
    public void Constructor_WithNullHttpContextAccessor_ThrowsArgumentNullException()
    {
        // Act & Assert
        var act = () => new HttpContextTargetingContextAccessor(null!);
        act.Should().Throw<ArgumentNullException>().WithParameterName("httpContextAccessor");
    }

    [Fact]
    public void Constructor_WithValidHttpContextAccessor_DoesNotThrow()
    {
        // Arrange
        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();

        // Act
        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Assert
        accessor.Should().NotBeNull();
    }

    #endregion

    #region GetContextAsync Tests

    [Fact]
    public async Task GetContextAsync_WithAuthenticatedUser_ReturnsUserIdFromIdentity()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "test-user")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context = await accessor.GetContextAsync();

        // Assert
        context.UserId.Should().Be("test-user");
    }

    [Fact]
    public async Task GetContextAsync_WithGroupClaims_ExtractsGroups()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "test-user"),
            new Claim("group", "group1"),
            new Claim("group", "group2"),
            new Claim("group", "admin")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context = await accessor.GetContextAsync();

        // Assert
        context.Groups.Should().HaveCount(3);
        context.Groups.Should().Contain("group1");
        context.Groups.Should().Contain("group2");
        context.Groups.Should().Contain("admin");
    }

    [Fact]
    public async Task GetContextAsync_WithNoGroupClaims_ReturnsEmptyGroups()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "user-without-groups")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context = await accessor.GetContextAsync();

        // Assert
        context.Groups.Should().BeEmpty();
    }

    [Fact]
    public async Task GetContextAsync_WithAnonymousUser_ReturnsNullUserId()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        httpContext.User = new ClaimsPrincipal(new ClaimsIdentity());

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context = await accessor.GetContextAsync();

        // Assert
        context.UserId.Should().BeNull();
    }

    [Fact]
    public async Task GetContextAsync_CachesContextInHttpContextItems()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "cached-user"),
            new Claim("group", "cached-group")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context1 = await accessor.GetContextAsync();
        var context2 = await accessor.GetContextAsync();

        // Assert
        context1.Should().BeSameAs(context2);
    }

    [Fact]
    public async Task GetContextAsync_ReturnsValueTaskDirectly()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "value-task-user")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var valueTask = accessor.GetContextAsync();

        // Assert
        valueTask.IsCompletedSuccessfully.Should().BeTrue();
        var context = await valueTask;
        context.UserId.Should().Be("value-task-user");
    }

    [Fact]
    public async Task GetContextAsync_WhenCalledTwice_ReturnsCachedContext()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "multiple-calls-user")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context1 = await accessor.GetContextAsync();

        // Change the user - should not affect cached context
        httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "different-user")
        }, "TestAuth"));

        var context2 = await accessor.GetContextAsync();

        // Assert - Should return the cached context, not reflect the changed user
        context1.UserId.Should().Be("multiple-calls-user");
        context2.UserId.Should().Be("multiple-calls-user");
        context1.Should().BeSameAs(context2);
    }

    [Fact]
    public async Task GetContextAsync_WithOtherClaimTypes_IgnoresNonGroupClaims()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "test-user"),
            new Claim(ClaimTypes.Email, "test@example.com"),
            new Claim(ClaimTypes.Role, "admin"),
            new Claim("group", "real-group")
        }, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);

        var httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        httpContextAccessorMock.Setup(m => m.HttpContext).Returns(httpContext);

        var accessor = new HttpContextTargetingContextAccessor(httpContextAccessorMock.Object);

        // Act
        var context = await accessor.GetContextAsync();

        // Assert
        context.Groups.Should().HaveCount(1);
        context.Groups.Should().Contain("real-group");
        context.Groups.Should().NotContain("admin");
        context.Groups.Should().NotContain("test@example.com");
    }

    #endregion
}
