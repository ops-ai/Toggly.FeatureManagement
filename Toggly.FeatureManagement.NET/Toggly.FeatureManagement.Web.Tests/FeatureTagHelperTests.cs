using FluentAssertions;
using Microsoft.AspNetCore.Razor.TagHelpers;
using Microsoft.FeatureManagement;
using Moq;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class FeatureTagHelperTests
{
    [Fact]
    public void TargetsFeatureElementAndFeatureAttribute()
    {
        var targets = typeof(FeatureTagHelper)
            .GetCustomAttributes(typeof(HtmlTargetElementAttribute), inherit: false)
            .Cast<HtmlTargetElementAttribute>()
            .ToList();

        targets.Should().Contain(t => t.Tag == "feature");
        targets.Should().Contain(t => t.Attributes == "feature");
    }

    [Fact]
    public async Task ProcessAsync_FeatureElement_PassesContextToFeatureManager()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager
            .Setup(m => m.IsEnabledAsync("OrderBadge", It.IsAny<object>()))
            .ReturnsAsync(true);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Name = "OrderBadge",
            Context = new { Id = 1, Color = "red" }
        };

        var output = CreateOutput("feature", "Featured order");
        await helper.ProcessAsync(CreateContext(), output);

        output.TagName.Should().BeNull();
        output.Content.GetContent().Should().Be("Featured order");
        featureManager.Verify(m => m.IsEnabledAsync("OrderBadge", helper.Context!), Times.Once);
        featureManager.Verify(m => m.IsEnabledAsync("OrderBadge"), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_FeatureElement_SuppressesWhenDisabled()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager
            .Setup(m => m.IsEnabledAsync("OrderBadge", It.IsAny<object>()))
            .ReturnsAsync(false);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Name = "OrderBadge",
            Context = new { Id = 1 }
        };

        var output = CreateOutput("feature", "Featured order");
        await helper.ProcessAsync(CreateContext(), output);

        output.IsContentModified.Should().BeTrue();
        output.Content.GetContent().Should().BeEmpty();
    }

    [Fact]
    public async Task ProcessAsync_AttributeForm_KeepsHostTagName()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager.Setup(m => m.IsEnabledAsync("OrderBadge")).ReturnsAsync(true);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Feature = "OrderBadge"
        };

        var output = CreateOutput("div", "inner");
        await helper.ProcessAsync(CreateContext(), output);

        output.TagName.Should().Be("div");
        output.Content.GetContent().Should().Be("inner");
    }

    [Fact]
    public async Task ProcessAsync_AttributeForm_StripsFeatureAttribute()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager.Setup(m => m.IsEnabledAsync("OrderBadge")).ReturnsAsync(true);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Feature = "OrderBadge"
        };

        var output = CreateOutput("div", "inner");
        output.Attributes.Add("feature", "OrderBadge");
        await helper.ProcessAsync(CreateContext(), output);

        output.Attributes.Should().NotContain(a => a.Name == "feature");
    }

    [Fact]
    public async Task ProcessAsync_DefaultRequirement_RequiresAllNames()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager.Setup(m => m.IsEnabledAsync("A")).ReturnsAsync(true);
        featureManager.Setup(m => m.IsEnabledAsync("B")).ReturnsAsync(false);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Name = "A,B"
        };

        var output = CreateOutput("feature", "inner");
        await helper.ProcessAsync(CreateContext(), output);

        output.Content.GetContent().Should().BeEmpty();
        featureManager.Verify(m => m.IsEnabledAsync("A"), Times.Once);
        featureManager.Verify(m => m.IsEnabledAsync("B"), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_RequirementAny_RendersWhenOneFlagIsOn()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager.Setup(m => m.IsEnabledAsync("A")).ReturnsAsync(false);
        featureManager.Setup(m => m.IsEnabledAsync("B")).ReturnsAsync(true);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Names = "A,B",
            Requirement = "Any"
        };

        var output = CreateOutput("feature", "inner");
        await helper.ProcessAsync(CreateContext(), output);

        output.Content.GetContent().Should().Be("inner");
    }

    [Fact]
    public async Task ProcessAsync_Negate_RendersWhenFeatureIsOff()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager.Setup(m => m.IsEnabledAsync("OffFlag")).ReturnsAsync(false);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Name = "OffFlag",
            Negate = true
        };

        var output = CreateOutput("feature", "hidden-content");
        await helper.ProcessAsync(CreateContext(), output);

        output.Content.GetContent().Should().Be("hidden-content");
    }

    [Fact]
    public async Task ProcessAsync_EmptyName_SuppressesOutput()
    {
        var featureManager = new Mock<IFeatureManager>();
        var helper = new FeatureTagHelper(featureManager.Object);

        var output = CreateOutput("feature", "inner");
        await helper.ProcessAsync(CreateContext(), output);

        output.Content.GetContent().Should().BeEmpty();
        featureManager.Verify(m => m.IsEnabledAsync(It.IsAny<string>()), Times.Never);
    }

    private static TagHelperContext CreateContext() =>
        new("feature", new TagHelperAttributeList(), new Dictionary<object, object>(), "test");

    private static TagHelperOutput CreateOutput(string tagName, string childContent)
    {
        return new TagHelperOutput(
            tagName,
            new TagHelperAttributeList(),
            (useCachedResult, encoder) =>
            {
                var content = new DefaultTagHelperContent();
                content.SetContent(childContent);
                return Task.FromResult<TagHelperContent>(content);
            });
    }
}
