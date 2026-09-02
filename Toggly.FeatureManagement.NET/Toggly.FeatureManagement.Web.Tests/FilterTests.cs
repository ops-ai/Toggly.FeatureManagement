using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Moq;
using System.Security.Claims;
using Toggly.FeatureManagement.Web.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class BrowserFamilyFilterTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly BrowserFamilyFilter _filter;

    public BrowserFamilyFilterTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _filter = new BrowserFamilyFilter(
            _httpContextAccessorMock.Object,
            Enumerable.Empty<ITargetingContextAccessor>());
    }

    private void SetupUserAgent(string userAgent)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["User-Agent"] = userAgent;
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
    }

    private FeatureFilterEvaluationContext CreateContext(string[] browserFamilies, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["BrowserFamily:0"] = browserFamilies.Length > 0 ? browserFamilies[0] : null,
                ["BrowserFamily:1"] = browserFamilies.Length > 1 ? browserFamilies[1] : null
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = "TestFeature",
            Parameters = config
        };
    }

    [Fact]
    public async Task EvaluateAsync_WithMatchingBrowser_And100Percent_ReturnsTrue()
    {
        // Arrange
        SetupUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "Chrome" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithNonMatchingBrowser_ReturnsFalse()
    {
        // Arrange
        SetupUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "Firefox" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_With0Percent_ReturnsFalse()
    {
        // Arrange
        SetupUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "Chrome" }, 0);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }
}

public class BrowserLanguageFilterTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly BrowserLanguageFilter _filter;

    public BrowserLanguageFilterTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _filter = new BrowserLanguageFilter(
            _httpContextAccessorMock.Object,
            Enumerable.Empty<ITargetingContextAccessor>());
    }

    private void SetupAcceptLanguage(string acceptLanguage)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["Accept-Language"] = acceptLanguage;
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
    }

    private FeatureFilterEvaluationContext CreateContext(string[] languages, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["BrowserLanguage:0"] = languages.Length > 0 ? languages[0] : null,
                ["BrowserLanguage:1"] = languages.Length > 1 ? languages[1] : null
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = "TestFeature",
            Parameters = config
        };
    }

    [Fact]
    public async Task EvaluateAsync_WithMatchingLanguage_And100Percent_ReturnsTrue()
    {
        // Arrange
        SetupAcceptLanguage("en-US,en;q=0.9");
        var context = CreateContext(new[] { "en" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithNonMatchingLanguage_ReturnsFalse()
    {
        // Arrange
        SetupAcceptLanguage("en-US,en;q=0.9");
        var context = CreateContext(new[] { "fr" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WithNullAcceptLanguage_ReturnsFalse()
    {
        // Arrange
        var httpContext = new DefaultHttpContext();
        // No Accept-Language header
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
        var context = CreateContext(new[] { "en" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }
}

public class CountryFilterTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly CountryFilter _filter;

    public CountryFilterTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _filter = new CountryFilter(
            _httpContextAccessorMock.Object,
            Enumerable.Empty<ITargetingContextAccessor>());
    }

    private void SetupCountryHeader(string country)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["CF-IPCountry"] = country;
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
    }

    private FeatureFilterEvaluationContext CreateContext(string[] countries, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["Country:0"] = countries.Length > 0 ? countries[0] : null,
                ["Country:1"] = countries.Length > 1 ? countries[1] : null
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = "TestFeature",
            Parameters = config
        };
    }

    [Fact]
    public async Task EvaluateAsync_WithMatchingCountry_And100Percent_ReturnsTrue()
    {
        // Arrange
        SetupCountryHeader("US");
        var context = CreateContext(new[] { "US" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithNonMatchingCountry_ReturnsFalse()
    {
        // Arrange
        SetupCountryHeader("US");
        var context = CreateContext(new[] { "CA" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WithCaseInsensitiveMatch_ReturnsTrue()
    {
        // Arrange
        SetupCountryHeader("us");
        var context = CreateContext(new[] { "US" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }
}

public class DeviceTypeFilterTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly DeviceTypeFilter _filter;

    public DeviceTypeFilterTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _filter = new DeviceTypeFilter(
            _httpContextAccessorMock.Object,
            Enumerable.Empty<ITargetingContextAccessor>());
    }

    private void SetupUserAgent(string userAgent)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["User-Agent"] = userAgent;
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
    }

    private FeatureFilterEvaluationContext CreateContext(string[] deviceTypes, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["DeviceType:0"] = deviceTypes.Length > 0 ? deviceTypes[0] : null,
                ["DeviceType:1"] = deviceTypes.Length > 1 ? deviceTypes[1] : null
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = "TestFeature",
            Parameters = config
        };
    }

    [Fact]
    public async Task EvaluateAsync_WithMobileDevice_And100Percent_ReturnsTrue()
    {
        // Arrange - iPhone user agent
        SetupUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1");
        var context = CreateContext(new[] { "iPhone" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithNonMatchingDevice_ReturnsFalse()
    {
        // Arrange - Desktop user agent
        SetupUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "iPhone" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }
}

public class OSFilterTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly OSFilter _filter;

    public OSFilterTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _filter = new OSFilter(
            _httpContextAccessorMock.Object,
            Enumerable.Empty<ITargetingContextAccessor>());
    }

    private void SetupUserAgent(string userAgent)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers["User-Agent"] = userAgent;
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
    }

    private FeatureFilterEvaluationContext CreateContext(string[] operatingSystems, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["OperatingSystem:0"] = operatingSystems.Length > 0 ? operatingSystems[0] : null,
                ["OperatingSystem:1"] = operatingSystems.Length > 1 ? operatingSystems[1] : null
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = "TestFeature",
            Parameters = config
        };
    }

    [Fact]
    public async Task EvaluateAsync_WithMatchingOS_And100Percent_ReturnsTrue()
    {
        // Arrange - Windows user agent
        SetupUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "Windows" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithNonMatchingOS_ReturnsFalse()
    {
        // Arrange - Windows user agent
        SetupUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "Mac OS" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WithMacOS_And100Percent_ReturnsTrue()
    {
        // Arrange - Mac user agent
        SetupUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
        var context = CreateContext(new[] { "Mac OS" }, 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }
}

public class UserClaimsFilterTests
{
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;
    private readonly UserClaimsFilter _filter;

    public UserClaimsFilterTests()
    {
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();
        _filter = new UserClaimsFilter(
            _httpContextAccessorMock.Object,
            Enumerable.Empty<ITargetingContextAccessor>());
    }

    private void SetupUserWithClaims(params Claim[] claims)
    {
        var httpContext = new DefaultHttpContext();
        var identity = new ClaimsIdentity(claims, "TestAuth");
        httpContext.User = new ClaimsPrincipal(identity);
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns(httpContext);
    }

    private FeatureFilterEvaluationContext CreateContext(string claim, string value, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["Claim"] = claim,
                ["Value"] = value
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = "TestFeature",
            Parameters = config
        };
    }

    [Fact]
    public async Task EvaluateAsync_WithMatchingClaim_And100Percent_ReturnsTrue()
    {
        // Arrange
        SetupUserWithClaims(new Claim("role", "admin"));
        var context = CreateContext("role", "admin", 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithNonMatchingClaim_ReturnsFalse()
    {
        // Arrange
        SetupUserWithClaims(new Claim("role", "user"));
        var context = CreateContext("role", "admin", 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WithNullHttpContext_ReturnsFalse()
    {
        // Arrange
        _httpContextAccessorMock.Setup(x => x.HttpContext).Returns((HttpContext?)null);
        var context = CreateContext("role", "admin", 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WithMissingClaim_ReturnsFalse()
    {
        // Arrange
        SetupUserWithClaims(new Claim("other", "value"));
        var context = CreateContext("role", "admin", 100);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_With0Percent_ReturnsFalse()
    {
        // Arrange
        SetupUserWithClaims(new Claim("role", "admin"));
        var context = CreateContext("role", "admin", 0);

        // Act
        var result = await _filter.EvaluateAsync(context);

        // Assert
        result.Should().BeFalse();
    }
}

public class SegmentStickyPercentageFilterTests
{
    private const string ChromeUa =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

    [Theory]
    [InlineData(61, true)]
    [InlineData(60, false)]
    public async Task BrowserFamily_WithUserId_UsesStickyPercentile(short percentage, bool expected)
    {
        var filter = CreateBrowserFamilyFilter("user-123");
        var result = await filter.EvaluateAsync(CreateBrowserFamilyContext("demo-feature", percentage));
        result.Should().Be(expected);
    }

    [Theory]
    [InlineData(61, true)]
    [InlineData(60, false)]
    public async Task Country_WithUserId_UsesStickyPercentile(short percentage, bool expected)
    {
        var http = new Mock<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["CF-IPCountry"] = "US";
        http.Setup(x => x.HttpContext).Returns(ctx);

        var targeting = new Mock<ITargetingContextAccessor>();
        targeting.Setup(a => a.GetContextAsync())
            .ReturnsAsync(new TargetingContext { UserId = "user-123" });

        var filter = new CountryFilter(http.Object, new[] { targeting.Object });
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["Country:0"] = "US"
            })
            .Build();

        var result = await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        });

        result.Should().Be(expected);
    }

    [Theory]
    [InlineData(61, true)]
    [InlineData(60, false)]
    public async Task UserClaims_WithUserId_UsesStickyPercentile(short percentage, bool expected)
    {
        var http = new Mock<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("role", "admin") }, "TestAuth"));
        http.Setup(x => x.HttpContext).Returns(ctx);

        var targeting = new Mock<ITargetingContextAccessor>();
        targeting.Setup(a => a.GetContextAsync())
            .ReturnsAsync(new TargetingContext { UserId = "user-123" });

        var filter = new UserClaimsFilter(http.Object, new[] { targeting.Object });
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["Claim"] = "role",
                ["Value"] = "admin"
            })
            .Build();

        var result = await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        });

        result.Should().Be(expected);
    }

    private static BrowserFamilyFilter CreateBrowserFamilyFilter(string userId)
    {
        var http = new Mock<IHttpContextAccessor>();
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["User-Agent"] = ChromeUa;
        http.Setup(x => x.HttpContext).Returns(ctx);

        var targeting = new Mock<ITargetingContextAccessor>();
        targeting.Setup(a => a.GetContextAsync())
            .ReturnsAsync(new TargetingContext { UserId = userId });

        return new BrowserFamilyFilter(http.Object, new[] { targeting.Object });
    }

    private static FeatureFilterEvaluationContext CreateBrowserFamilyContext(string featureName, short percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = percentage.ToString(),
                ["BrowserFamily:0"] = "Chrome"
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = featureName,
            Parameters = config
        };
    }
}
