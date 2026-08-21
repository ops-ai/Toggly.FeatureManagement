using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Moq;
using System.Collections.Generic;
using System.Net;
using System.Security.Claims;
using Toggly.FeatureManagement.Web;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class HttpFeatureContextProviderTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly HttpFeatureContextProvider _provider;

    public HttpFeatureContextProviderTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _provider = new HttpFeatureContextProvider(_httpContextAccessorMock.Object);
    }

    private static DefaultHttpContext CreateHttpContext(
        string? userName = null,
        string? remoteIp = null)
    {
        var context = new DefaultHttpContext();

        if (userName != null)
        {
            var claims = new[] { new Claim(ClaimTypes.Name, userName) };
            var identity = new ClaimsIdentity(claims, "TestAuth");
            context.User = new ClaimsPrincipal(identity);
        }

        if (remoteIp != null)
        {
            context.Connection.RemoteIpAddress = IPAddress.Parse(remoteIp);
        }

        return context;
    }

    #region AccessedInRequestAsync Tests

    [Fact]
    public async Task AccessedInRequestAsync_ReturnsFalse_OnFirstCall()
    {
        // Arrange
        var context = CreateHttpContext();
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        // Act
        var result = await _provider.AccessedInRequestAsync("test-feature");

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task AccessedInRequestAsync_ReturnsTrue_OnSubsequentCalls()
    {
        // Arrange
        var context = CreateHttpContext();
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        // Act
        await _provider.AccessedInRequestAsync("test-feature"); // First call
        var result = await _provider.AccessedInRequestAsync("test-feature"); // Second call

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task AccessedInRequestAsync_ReturnsTrue_WhenHttpContextIsNull()
    {
        // Arrange
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns((HttpContext?)null);

        // Act
        var result = await _provider.AccessedInRequestAsync("test-feature");

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task AccessedInRequestAsync_TracksFeaturesIndependently()
    {
        // Arrange
        var context = CreateHttpContext();
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        // Act
        await _provider.AccessedInRequestAsync("feature1"); // First call for feature1
        var result1 = await _provider.AccessedInRequestAsync("feature2"); // First call for feature2

        // Assert
        result1.Should().BeFalse();
    }

    [Fact]
    public async Task AccessedInRequestAsyncWithContext_ReturnsFalse_OnFirstCall()
    {
        // Arrange
        var context = CreateHttpContext();
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);
        var customContext = new { UserId = "123" };

        // Act
        var result = await _provider.AccessedInRequestAsync("test-feature", customContext);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task AccessedInRequestAsyncWithContext_ReturnsTrue_WhenHttpContextIsNull()
    {
        // Arrange
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns((HttpContext?)null);
        var customContext = new { UserId = "123" };

        // Act
        var result = await _provider.AccessedInRequestAsync("test-feature", customContext);

        // Assert
        result.Should().BeTrue();
    }

    #endregion

    #region GetContextIdentifierAsync Tests

    [Fact]
    public async Task GetContextIdentifierAsync_ReturnsUserName_WhenAuthenticated()
    {
        // Arrange
        var context = CreateHttpContext(userName: "testuser@example.com");
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        // Act
        var result = await _provider.GetContextIdentifierAsync();

        // Assert
        result.Should().Be("testuser@example.com");
    }

    [Fact]
    public async Task GetContextIdentifierAsync_ReturnsIpAddress_WhenNoUserIdentity()
    {
        // Arrange
        var context = CreateHttpContext(remoteIp: "192.168.1.100");
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        // Act
        var result = await _provider.GetContextIdentifierAsync();

        // Assert
        result.Should().Be("192.168.1.100");
    }

    [Fact]
    public async Task GetContextIdentifierAsync_ReturnsEmptyString_WhenHttpContextIsNull()
    {
        // Arrange
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns((HttpContext?)null);

        // Act
        var result = await _provider.GetContextIdentifierAsync();

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetContextIdentifierAsync_PrefersUserName_OverIpAddress()
    {
        // Arrange
        var context = CreateHttpContext(userName: "testuser", remoteIp: "192.168.1.1");
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        // Act
        var result = await _provider.GetContextIdentifierAsync();

        // Assert
        result.Should().Be("testuser");
    }

    [Fact]
    public async Task GetContextIdentifierAsyncWithContext_ReturnsUserName_WhenAuthenticated()
    {
        // Arrange
        var context = CreateHttpContext(userName: "contextuser");
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);
        var customContext = new { TenantId = "tenant-1" };

        // Act
        var result = await _provider.GetContextIdentifierAsync(customContext);

        // Assert
        result.Should().Be("contextuser");
    }

    [Fact]
    public async Task GetContextIdentifierAsyncWithContext_ReturnsEmptyString_WhenHttpContextIsNull()
    {
        // Arrange
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns((HttpContext?)null);
        var customContext = new { TenantId = "tenant-1" };

        // Act
        var result = await _provider.GetContextIdentifierAsync(customContext);

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public async Task GetContextIdentifierAsyncWithContext_AppendsEntityKindAndKey()
    {
        var context = CreateHttpContext(userName: "user1");
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(context);

        var entityResolver = new Mock<ITogglyEntityContextResolver>();
        entityResolver
            .Setup(r => r.TryResolve(It.IsAny<object>(), out It.Ref<Toggly.FeatureManagement.Context.TogglyEntityContext?>.IsAny))
            .Returns((object _, out Toggly.FeatureManagement.Context.TogglyEntityContext? entity) =>
            {
                entity = new Toggly.FeatureManagement.Context.TogglyEntityContext(
                    "Puppy",
                    "42",
                    new Dictionary<string, object?>());
                return true;
            });

        var provider = new HttpFeatureContextProvider(_httpContextAccessorMock.Object, entityResolver.Object);
        var result = await provider.GetContextIdentifierAsync(new { Id = 42 });

        result.Should().Be("user1|Puppy|42");
    }

    #endregion
}
