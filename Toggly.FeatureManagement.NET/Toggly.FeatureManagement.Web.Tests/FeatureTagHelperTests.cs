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
            .Setup(m => m.IsEnabledAsync("PuppyBadge", It.IsAny<object>()))
            .ReturnsAsync(true);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Name = "PuppyBadge",
            Context = new { Id = 1, Color = "red" }
        };

        var output = CreateOutput("feature", "Featured puppy");
        await helper.ProcessAsync(CreateContext(), output);

        output.TagName.Should().BeNull();
        output.Content.GetContent().Should().Be("Featured puppy");
        featureManager.Verify(m => m.IsEnabledAsync("PuppyBadge", helper.Context!), Times.Once);
        featureManager.Verify(m => m.IsEnabledAsync("PuppyBadge"), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_FeatureElement_SuppressesWhenDisabled()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager
            .Setup(m => m.IsEnabledAsync("PuppyBadge", It.IsAny<object>()))
            .ReturnsAsync(false);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Name = "PuppyBadge",
            Context = new { Id = 1 }
        };

        var output = CreateOutput("feature", "Featured puppy");
        await helper.ProcessAsync(CreateContext(), output);

        output.IsContentModified.Should().BeTrue();
        output.Content.GetContent().Should().BeEmpty();
    }

    [Fact]
    public async Task ProcessAsync_AttributeForm_KeepsHostTagName()
    {
        var featureManager = new Mock<IFeatureManager>();
        featureManager.Setup(m => m.IsEnabledAsync("PuppyBadge")).ReturnsAsync(true);

        var helper = new FeatureTagHelper(featureManager.Object)
        {
            Feature = "PuppyBadge"
        };

        var output = CreateOutput("div", "inner");
        await helper.ProcessAsync(CreateContext(), output);

        output.TagName.Should().Be("div");
        output.Content.GetContent().Should().Be("inner");
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
