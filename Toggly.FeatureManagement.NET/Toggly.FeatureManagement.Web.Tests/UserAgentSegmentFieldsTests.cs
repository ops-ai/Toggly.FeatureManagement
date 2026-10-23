using FluentAssertions;
using Toggly.FeatureManagement.Web.Filters;
using UAParser;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class UserAgentSegmentFieldsTests
{
    private static readonly string[] MacintoshAllowList = { "Macintosh" };
    private static readonly string[] MacOsAllowList = { "Mac" };
    private static readonly string[] ChromeAllowList = { "Chrome" };

    private const string MacChromeDesktopUa =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private const string IPhoneSafariUa =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

    [Fact]
    public void GetDeviceFamily_NormalizesMacToMacintosh()
    {
        var ua = Parser.GetDefault().Parse(MacChromeDesktopUa);
        UserAgentSegmentFields.GetDeviceFamily(ua).Should().Be("Macintosh");
    }

    [Fact]
    public void GetDeviceFamily_LeavesIPhoneUnchanged()
    {
        var ua = Parser.GetDefault().Parse(IPhoneSafariUa);
        UserAgentSegmentFields.GetDeviceFamily(ua).Should().Be("iPhone");
    }

    [Fact]
    public void MatchesIndexedAllowList_MacintoshMatchesNormalizedDesktopMac()
    {
        var ua = Parser.GetDefault().Parse(MacChromeDesktopUa);
        var deviceFamily = UserAgentSegmentFields.GetDeviceFamily(ua);
        UserAgentSegmentFields.MatchesIndexedAllowList(deviceFamily, new[] { "Macintosh" })
            .Should().BeTrue();
    }

    [Fact]
    public void GetOperatingSystemFamily_MacDesktopUa_MatchesMacWireName()
    {
        var ua = Parser.GetDefault().Parse(MacChromeDesktopUa);
        var osFamily = UserAgentSegmentFields.GetOperatingSystemFamily(ua);
        UserAgentSegmentFields.MatchesIndexedAllowList(osFamily, new[] { "Mac" })
            .Should().BeTrue();
    }

    [Fact]
    public void GetBrowserFamily_ChromeDesktopUa_MatchesChrome()
    {
        var ua = Parser.GetDefault().Parse(MacChromeDesktopUa);
        var browser = UserAgentSegmentFields.GetBrowserFamily(ua);
        UserAgentSegmentFields.MatchesIndexedAllowList(browser, new[] { "Chrome" })
            .Should().BeTrue();
    }
}
