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

    [Fact]
    public async Task EvaluateAsync_NullContext_Throws()
    {
        var filter = new TogglyPercentageFilter(BuildProvider(CreateAccessor("user-123")));
        var act = () => filter.EvaluateAsync(null!);
        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    [Fact]
    public async Task EvaluateAsync_ZeroOrFullPercentage_ShortCircuits()
    {
        var filter = new TogglyPercentageFilter(BuildProvider(CreateAccessor("user-123")));

        (await filter.EvaluateAsync(CreateContext("demo-feature", 0))).Should().BeFalse();
        (await filter.EvaluateAsync(CreateContext("demo-feature", 100))).Should().BeTrue();
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

    [Fact]
    public async Task EvaluateAsync_NullContext_Throws()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("alice")));
        var act = () => filter.EvaluateAsync(null!);
        await act.Should().ThrowAsync<ArgumentNullException>();
    }

    [Fact]
    public async Task EvaluateAsync_ExclusionUser_ReturnsFalse()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("alice")));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience.Exclusion.Users:0"] = "alice",
                ["Audience.DefaultRolloutPercentage"] = "100"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_ExclusionGroup_ReturnsFalse()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("alice", new[] { "beta" })));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience.Exclusion.Groups:0"] = "beta",
                ["Audience.DefaultRolloutPercentage"] = "100"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_InclusionGroup_ReturnsTrue()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("alice", new[] { "beta" })));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience.Groups:0"] = "beta",
                ["Audience.DefaultRolloutPercentage"] = "0"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_MfNamedGroups_FallbackMatches()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("alice", new[] { "beta" })));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience:Groups:0:Name"] = "beta",
                ["Audience:DefaultRolloutPercentage"] = "0"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_PercentageKey_FallbackRollout()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("user-123")));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = "61"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_BoundAudienceDefaultRollout_UsesSettings()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("user-123")));
        // Only colon-bound Audience path (no Audience.DefaultRolloutPercentage / Percentage keys).
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Audience:DefaultRolloutPercentage"] = "61"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_ZeroAndFullRollout_ShortCircuits()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("user-123")));

        (await filter.EvaluateAsync(CreateRolloutContext("demo-feature", 0))).Should().BeFalse();
        (await filter.EvaluateAsync(CreateRolloutContext("demo-feature", 100))).Should().BeTrue();
    }

    [Fact]
    public async Task EvaluateAsync_InvalidPercentage_FailsClosed()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("user-123")));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Percentage"] = "not-a-number",
                ["Audience.DefaultRolloutPercentage"] = ""
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeFalse();
    }

    [Fact]
    public async Task EvaluateAsync_CaseSensitiveExclusion_Misses()
    {
        var filter = new TogglyTargetingFilter(BuildProvider(CreateAccessor("Alice")));
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["IgnoreCase"] = "false",
                ["Audience.Exclusion.Users:0"] = "alice",
                ["Audience.DefaultRolloutPercentage"] = "100"
            })
            .Build();

        (await filter.EvaluateAsync(new FeatureFilterEvaluationContext
        {
            FeatureName = "demo-feature",
            Parameters = config
        })).Should().BeTrue();
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

    private static ITargetingContextAccessor CreateAccessor(string userId, IEnumerable<string>? groups = null)
    {
        var mock = new Mock<ITargetingContextAccessor>();
        mock.Setup(a => a.GetContextAsync())
            .ReturnsAsync(new TargetingContext { UserId = userId, Groups = groups });
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
