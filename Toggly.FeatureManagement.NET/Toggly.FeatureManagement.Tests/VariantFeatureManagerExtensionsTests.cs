using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Moq;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class VariantFeatureManagerExtensionsTests
{
    [Fact]
    public async Task GetVariantValueAsync_BindsObjectConfiguration()
    {
        var manager = CreateManager(CreateVariant("theme", new Dictionary<string, string?>
        {
            ["config:primary"] = "#112233",
            ["config:fontSize"] = "14"
        }, sectionKey: "config"));

        var value = await manager.GetVariantValueAsync<ThemeConfig>("checkout-theme");

        value.Should().NotBeNull();
        value!.Primary.Should().Be("#112233");
        value.FontSize.Should().Be(14);
    }

    [Fact]
    public async Task GetVariantValueAsync_BindsScalarConfiguration()
    {
        var manager = CreateManager(CreateVariant("size", new Dictionary<string, string?>
        {
            ["config"] = "42"
        }, sectionKey: "config"));

        var value = await manager.GetVariantValueAsync<int>("checkout-size");

        value.Should().Be(42);
    }

    [Fact]
    public async Task GetVariantValueAsync_ReturnsDefault_WhenBindMismatches()
    {
        var manager = CreateManager(CreateVariant("size", new Dictionary<string, string?>
        {
            ["config"] = "not-an-int"
        }, sectionKey: "config"));

        var value = await manager.GetVariantValueAsync<int>("checkout-size");

        value.Should().Be(0);
    }

    [Fact]
    public async Task GetVariantValueAsync_ReturnsDefault_WhenVariantMissing()
    {
        var manager = CreateManager(variant: null);

        var value = await manager.GetVariantValueAsync<ThemeConfig>("missing-feature");

        value.Should().BeNull();
    }

    [Fact]
    public async Task GetVariantValueAsync_WithTargetingContext_UsesContextOverload()
    {
        var context = new TargetingContext { UserId = "alice" };
        var managerMock = new Mock<IVariantFeatureManager>();
        managerMock
            .Setup(m => m.GetVariantAsync(
                "checkout-theme",
                It.Is<ITargetingContext>(c => c.UserId == "alice"),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(CreateVariant("theme", new Dictionary<string, string?>
            {
                ["config:primary"] = "#abcdef",
                ["config:fontSize"] = "16"
            }, sectionKey: "config"));

        var value = await managerMock.Object.GetVariantValueAsync<ThemeConfig>("checkout-theme", context);

        value.Should().NotBeNull();
        value!.Primary.Should().Be("#abcdef");
        value.FontSize.Should().Be(16);
        managerMock.Verify(
            m => m.GetVariantAsync(
                "checkout-theme",
                It.Is<ITargetingContext>(c => c.UserId == "alice"),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    private static IVariantFeatureManager CreateManager(Variant? variant)
    {
        var managerMock = new Mock<IVariantFeatureManager>();
        managerMock
            .Setup(m => m.GetVariantAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(variant);
        return managerMock.Object;
    }

    private static Variant CreateVariant(string name, Dictionary<string, string?> data, string sectionKey)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(data)
            .Build();

        return new Variant
        {
            Name = name,
            Configuration = configuration.GetSection(sectionKey)
        };
    }

    private sealed class ThemeConfig
    {
        public string? Primary { get; set; }
        public int FontSize { get; set; }
    }
}
