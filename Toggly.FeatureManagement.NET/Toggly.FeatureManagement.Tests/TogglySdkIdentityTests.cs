using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglySdkIdentityTests
{
    [Fact]
    public void Version_IsNonEmptySemverFromPackage()
    {
        TogglySdkIdentity.Version.Should().NotBeNullOrWhiteSpace();
        TogglySdkIdentity.Version.Should().NotBe("unknown");
        TogglySdkIdentity.Version.Should().NotBe("0.0.0.0");
        TogglySdkIdentity.Version.Should().MatchRegex(@"^\d+\.\d+\.\d+");
    }

    [Fact]
    public void UserAgent_MatchesPlatformSdkUserAgentParserShape()
    {
        TogglySdkIdentity.UserAgent.Should().Be($"toggly-dotnet/{TogglySdkIdentity.Version}");
        TogglySdkIdentity.UserAgent.Should().MatchRegex(@"^toggly-dotnet/\S+$");
    }
}
