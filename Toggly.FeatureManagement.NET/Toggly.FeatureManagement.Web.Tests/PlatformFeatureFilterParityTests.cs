using System;
using System.Collections.Generic;
using System.Linq;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Toggly.CLI.Filters;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Filters;
using Toggly.FeatureManagement.Web.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Web.Tests;

public class PlatformFeatureFilterParityTests
{
    [Fact]
    public void AllCatalogWireNames_MapToRegisteredFilters_AfterAddTogglyWeb()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTogglyWeb(new Toggly.FeatureManagement.TogglySettings
        {
            AppKey = "test-key",
            Environment = "Production"
        });

        var registrationIndex = FeatureFilterRegistrationIndex.FromServiceCollection(services);

        var wireNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in StandardFilterCatalog.KnownNames)
            wireNames.Add(name);
        foreach (var name in CatalogValidator.KnownFilterNames)
            wireNames.Add(name);
        foreach (var name in PlatformFeatureFilterParityCatalog.AllWireNames)
            wireNames.Add(name);

        var missing = new List<string>();
        foreach (var wireName in wireNames)
        {
            var mapped = TogglyFeatureProvider.MapToMicrosoftFeatureFilterName(wireName);
            if (!registrationIndex.IsRegistered(mapped))
                missing.Add($"{wireName} -> {mapped}");
        }

        missing.Should().BeEmpty(
            "every platform catalog filter name must map to a registered .NET filter: {0}",
            string.Join(", ", missing));
    }
}
