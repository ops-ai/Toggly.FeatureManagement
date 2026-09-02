using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Moq;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyPercentageFilterTests
{
    [Fact]
    public async Task EvaluateAsync_WithUser_UsesStickyPercentile()
    {
        var accessor = CreateAccessor("user-123");
        var filter = new TogglyPercentageFilter(BuildProvider(accessor));

        // demo-feature / user-123 bucket ≈ 60.1
        (await filter.EvaluateAsync(CreateContext("demo-feature", 61))).Should().BeTrue();
        (await filter.EvaluateAsync(CreateContext("demo-feature", 60))).Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_WithoutUser_FailsClosed()
    {
        var filter = new TogglyPercentageFilter(BuildProvider(targetingAccessor: null));

        (await filter.EvaluateAsync(CreateContext("demo-feature", 50))).Should().BeFalse();
    }

    private static FeatureFilterEvaluationContext CreateContext(string featureName, int value)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Value"] = value.ToString()
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = featureName,
            Parameters = config
        };
    }

    private static ITargetingContextAccessor CreateAccessor(string userId)
    {
        var mock = new Mock<ITargetingContextAccessor>();
        mock.Setup(a => a.GetContextAsync())
            .ReturnsAsync(new TargetingContext { UserId = userId });
        return mock.Object;
    }

    private static IServiceProvider BuildProvider(ITargetingContextAccessor? targetingAccessor)
    {
        var services = new ServiceCollection();
        if (targetingAccessor != null)
            services.AddSingleton(targetingAccessor);
        return services.BuildServiceProvider();
    }
}

public class TogglyTargetingFilterTests
{
    [Fact]
    public async Task EvaluateAsync_DefaultRollout_UsesDefinitionsHashOrder()
    {
        var accessor = CreateAccessor("user-123");
        var filter = new TogglyTargetingFilter(BuildProvider(accessor));

        (await filter.EvaluateAsync(CreateRolloutContext("demo-feature", 61))).Should().BeTrue();
        (await filter.EvaluateAsync(CreateRolloutContext("demo-feature", 60))).Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_InclusionUser_ReturnsTrue()
    {
        var accessor = CreateAccessor("alice");
        var filter = new TogglyTargetingFilter(BuildProvider(accessor));

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience.Users:0"] = "alice",
                ["Audience.DefaultRolloutPercentage"] = "0"
            })
            .Build();

        var context = new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        };

        (await filter.EvaluateAsync(context)).Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_WithoutUser_FailsClosedOnPartialRollout()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(null));

        (await filter.EvaluateAsync(CreateRolloutContext("demo-feature", 50))).Should().BeFalse();
    }

    private static FeatureFilterEvaluationContext CreateRolloutContext(string featureName, double percentage)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience.DefaultRolloutPercentage"] = percentage.ToString(System.Globalization.CultureInfo.InvariantCulture)
            })
            .Build();

        return new FeatureFilterEvaluationContext
        {
            FeatureName = featureName,
            Parameters = config
        };
    }

    private static ITargetingContextAccessor CreateAccessor(string userId)
    {
        var mock = new Mock<ITargetingContextAccessor>();
        mock.Setup(a => a.GetContextAsync())
            .ReturnsAsync(new TargetingContext { UserId = userId });
        return mock.Object;
    }

    private static IServiceProvider BuildProvider(ITargetingContextAccessor? targetingAccessor)
    {
        var services = new ServiceCollection();
        if (targetingAccessor != null)
            services.AddSingleton(targetingAccessor);
        return services.BuildServiceProvider();
    }
}
