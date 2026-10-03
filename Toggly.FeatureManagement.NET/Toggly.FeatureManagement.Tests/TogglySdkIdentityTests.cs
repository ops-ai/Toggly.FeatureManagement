using System.Net.Http.Headers;
using System.Reflection;
using System.Reflection.Emit;
using System.Text.RegularExpressions;
using System.Xml.Linq;
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
    public void InformationalVersion_UsesDeclaredPackageVersion()
    {
        var manifest = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../..", "Directory.Build.props"));
        var packageVersion = XDocument.Load(manifest).Descendants("Version").Single().Value;
        var assembly = typeof(TogglySdkIdentity).Assembly;

        assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()!
            .InformationalVersion.Should().Be(packageVersion);
        TogglySdkIdentity.Version.Should().Be(packageVersion.Split('+')[0]);
        var header = new ProductInfoHeaderValue("toggly-dotnet", TogglySdkIdentity.Version);
        header.ToString().Should().Be(TogglySdkIdentity.UserAgent);
    }

    [Fact]
    public void UserAgent_MatchesPlatformSdkUserAgentParserShape()
    {
        TogglySdkIdentity.UserAgent.Should().Be($"toggly-dotnet/{TogglySdkIdentity.Version}");
        TogglySdkIdentity.UserAgent.Should().MatchRegex(@"^toggly-dotnet/\S+$");
    }

    [Theory]
    [InlineData(null, false, "")]
    [InlineData("", false, "")]
    [InlineData("   ", false, "")]
    [InlineData("0.0.0.0", false, "")]
    [InlineData("3.0.4-{BranchName}.1", false, "")]
    [InlineData("1.2.3-01", false, "")]
    [InlineData("1.2.3-beta..1", false, "")]
    [InlineData("03.2.1", false, "")]
    [InlineData("1.2.3/unsafe", false, "")]
    [InlineData("3.6.6", true, "3.6.6")]
    [InlineData("3.6.6+abc123", true, "3.6.6")]
    [InlineData(" 1.2.3-beta.1 ", true, "1.2.3-beta.1")]
    public void TryNormalize_HandlesRawVersions(string? raw, bool ok, string expected)
    {
        var success = TogglySdkIdentity.TryNormalize(raw, out var version);
        success.Should().Be(ok);
        version.Should().Be(expected);
    }

    [Theory]
    [InlineData(true, "3.12.7")]
    [InlineData(false, "")]
    public void TryNormalize_UsesBoundedMatcherOutcome(bool matches, string expected)
    {
        var success = TogglySdkIdentity.TryNormalize("3.12.7+build.01", out var version,
            (input, pattern, options, timeout) =>
            {
                input.Should().Be("3.12.7");
                timeout.Should().BeGreaterThan(TimeSpan.Zero);
                timeout.Should().BeLessThanOrEqualTo(TimeSpan.FromSeconds(1));
                return matches;
            });

        success.Should().Be(matches);
        version.Should().Be(expected);
    }

    [Fact]
    public void TryNormalize_ReturnsFalseAndEmptyVersionWhenMatcherTimesOut()
    {
        var success = TogglySdkIdentity.TryNormalize("3.12.7", out var version,
            (input, pattern, options, timeout) => throw new RegexMatchTimeoutException(input, pattern, timeout));

        success.Should().BeFalse();
        version.Should().BeEmpty();
    }

    [Fact]
    public void ResolveVersion_PrefersInformationalOverFile()
    {
        var asm = EmitAssembly(
            informational: "9.9.9+meta",
            file: "1.0.0.0",
            nameVersion: new Version(2, 0, 0, 0));

        TogglySdkIdentity.ResolveVersion(asm).Should().Be("9.9.9");
    }

    [Fact]
    public void ResolveVersion_FallsBackToFileWhenInformationalMissing()
    {
        var asm = EmitAssembly(
            informational: null,
            file: "8.1.0",
            nameVersion: new Version(2, 0, 0, 0));

        TogglySdkIdentity.ResolveVersion(asm).Should().Be("8.1.0");
    }

    [Fact]
    public void ResolveVersion_FallsBackToThreePartAssemblyName()
    {
        var asm = EmitAssembly(
            informational: null,
            file: null,
            nameVersion: new Version(7, 2, 1, 0));

        TogglySdkIdentity.ResolveVersion(asm).Should().Be("7.2.1");
    }

    [Fact]
    public void ResolveVersion_UsesFourPartAssemblyNameWhenRevisionSet()
    {
        var asm = EmitAssembly(
            informational: null,
            file: null,
            nameVersion: new Version(7, 2, 1, 4));

        TogglySdkIdentity.ResolveVersion(asm).Should().Be("7.2.1.4");
    }

    [Fact]
    public void ResolveVersion_ReturnsUnknownWhenNoUsableVersion()
    {
        var asm = EmitAssembly(
            informational: "0.0.0.0",
            file: "   ",
            nameVersion: new Version(0, 0, 0, 0));

        TogglySdkIdentity.ResolveVersion(asm).Should().Be("unknown");
    }

    [Fact]
    public void ResolveVersion_FallsBackToFileWhenInformationalMalformed()
    {
        var asm = EmitAssembly(
            informational: "3.0.4-{BranchName}.1",
            file: "3.12.6.0",
            nameVersion: new Version(2, 0, 0, 0));

        TogglySdkIdentity.ResolveVersion(asm).Should().Be("3.12.6.0");
    }

    private static Assembly EmitAssembly(string? informational, string? file, Version nameVersion)
    {
        var assemblyName = new AssemblyName("TogglySdkIdentityCoverage")
        {
            Version = nameVersion
        };
        var ab = AssemblyBuilder.DefineDynamicAssembly(assemblyName, AssemblyBuilderAccess.Run);
        if (informational != null)
            ab.SetCustomAttribute(BuildStringAttrCtor(typeof(AssemblyInformationalVersionAttribute), informational));
        if (file != null)
            ab.SetCustomAttribute(BuildStringAttrCtor(typeof(AssemblyFileVersionAttribute), file));
        ab.DefineDynamicModule("main");
        return ab;
    }

    private static CustomAttributeBuilder BuildStringAttrCtor(Type attributeType, string value)
    {
        var ctor = attributeType.GetConstructor(new[] { typeof(string) })
            ?? throw new InvalidOperationException($"Missing ctor on {attributeType}");
        return new CustomAttributeBuilder(ctor, new object[] { value });
    }
}
