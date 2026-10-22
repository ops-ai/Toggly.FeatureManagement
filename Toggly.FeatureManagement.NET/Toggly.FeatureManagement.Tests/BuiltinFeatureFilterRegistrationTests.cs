using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class BuiltinFeatureFilterRegistrationTests
{
    [Fact]
    public void AddTogglyFeatureManagement_RegistersAlwaysOn()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTogglyFeatureManagement();

        services.Should().Contain(d =>
            d.ServiceType == typeof(IFeatureFilterMetadata)
            && d.ImplementationType == typeof(AlwaysOnFeatureFilter));
    }

    [Fact]
    public void AddTogglyFeatureManagement_FailsClosedOnUnknownFilters()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTogglyFeatureManagement();

        var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<FeatureManagementOptions>>();

        options.Value.IgnoreMissingFeatureFilters.Should().BeFalse();
    }
}
