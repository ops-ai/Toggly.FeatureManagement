using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Models;
using Xunit;

namespace Toggly.CLI.Tests;

public class FeatureDefinitionSerializeTests
{
    [Fact]
    public void MetadataOnlyUpdate_OmitsNullFiltersVariantsAndAllocation()
    {
        var model = new FeatureDefinition
        {
            FeatureKey = "flag",
            Name = "Flag",
        };

        var json = JsonSerializer.Serialize(model, TogglyJsonSerializerContext.Default.FeatureDefinition);

        Assert.DoesNotContain("\"filters\"", json);
        Assert.DoesNotContain("\"variants\"", json);
        Assert.DoesNotContain("\"allocation\"", json);
        Assert.Contains("\"featureKey\":\"flag\"", json);
    }
}
