#nullable enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Microsoft.FeatureManagement.Telemetry;
using Xunit;

namespace Toggly.FeatureManagement.Parity.Tests;

/// <summary>
/// Replays variant-allocator-corpus/cases.json against Microsoft.FeatureManagement's
/// <see cref="FeatureManager"/> (the same oracle that generated the corpus).
/// </summary>
public class VariantAllocatorCorpusTests
{
    /// <summary>
    /// Known corpus divergences after dependency bumps. Empty unless MF assignment
    /// drift is observed; do not change allocator behavior to clear these.
    /// </summary>
    private static readonly Dictionary<string, string> KnownFailures = new(StringComparer.Ordinal);

    [Fact]
    public void CorpusFileExistsAndHasCases()
    {
        var path = SharedFixturePaths.ResolveVariantAllocatorCorpusPath();
        File.Exists(path).Should().BeTrue("variant-allocator-corpus/cases.json must be present");

        using var document = JsonDocument.Parse(File.ReadAllText(path));
        document.RootElement.ValueKind.Should().Be(JsonValueKind.Array);
        document.RootElement.GetArrayLength().Should().BeGreaterThan(0);
    }

    public static TheoryData<string, string> CorpusCases()
    {
        var data = new TheoryData<string, string>();
        var path = SharedFixturePaths.ResolveVariantAllocatorCorpusPath();
        using var document = JsonDocument.Parse(File.ReadAllText(path));
        foreach (var caseNode in document.RootElement.EnumerateArray())
        {
            var id = caseNode.GetProperty("id").GetString() ?? "unknown";
            data.Add(id, caseNode.GetRawText());
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(CorpusCases))]
    public async Task CorpusCase_MatchesMicrosoftFeatureManagement(string caseId, string caseJson)
    {
        using var document = JsonDocument.Parse(caseJson);
        var root = document.RootElement;

        ActivityEvent? capturedEvent = null;
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "Microsoft.FeatureManagement",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activity =>
            {
                foreach (var evt in activity.Events)
                {
                    if (evt.Name == "FeatureFlag")
                        capturedEvent = evt;
                }
            }
        };
        ActivitySource.AddActivityListener(listener);

        var feature = root.GetProperty("feature");
        var targeting = root.GetProperty("targeting");
        var expected = root.GetProperty("expected");
        var ignoreCase = root.TryGetProperty("ignoreCase", out var ignoreCaseNode) && ignoreCaseNode.ValueKind == JsonValueKind.True;

        var definition = BuildFeatureDefinition(feature);
        var provider = new SingleFeatureDefinitionProvider(definition);
        var manager = new FeatureManager(provider, new FeatureManagementOptions
        {
            IgnoreMissingFeatureFilters = true
        })
        {
            AssignerOptions = new TargetingEvaluationOptions { IgnoreCase = ignoreCase }
        };

        var targetingContext = new TargetingContext
        {
            UserId = targeting.TryGetProperty("userId", out var userId) && userId.ValueKind == JsonValueKind.String
                ? userId.GetString()
                : null,
            Groups = targeting.TryGetProperty("groups", out var groups) && groups.ValueKind == JsonValueKind.Array
                ? groups.EnumerateArray().Where(g => g.ValueKind == JsonValueKind.String).Select(g => g.GetString()!).ToList()
                : new List<string>()
        };

        var variant = await manager.GetVariantAsync(definition.Name, targetingContext);

        var expectedVariantName = expected.TryGetProperty("variantName", out var vn) && vn.ValueKind == JsonValueKind.String
            ? vn.GetString()
            : null;
        var expectedEnabled = expected.GetProperty("enabled").GetBoolean();
        var expectedReason = expected.GetProperty("assignmentReason").GetString();

        if (KnownFailures.TryGetValue(caseId, out var knownReason))
        {
            Assert.True(true, $"Known failure '{caseId}': {knownReason}");
            return;
        }

        // Mirror VariantOracle: require FeatureFlag telemetry before comparing
        // enabled / assignmentReason — missing tags must fail the case, not skip.
        capturedEvent.Should().NotBeNull(
            "case {0}: FeatureFlag telemetry event was not captured", caseId);
        var tags = capturedEvent!.Value.Tags.ToDictionary(t => t.Key, t => t.Value);

        tags.TryGetValue("Enabled", out var enabledObj).Should().BeTrue(
            "case {0}: Enabled telemetry tag missing", caseId);
        enabledObj.Should().BeOfType<bool>("case {0}: Enabled telemetry tag must be bool", caseId);
        ((bool)enabledObj!).Should().Be(expectedEnabled, "case {0}: enabled (telemetry)", caseId);

        tags.TryGetValue("VariantAssignmentReason", out var reasonObj).Should().BeTrue(
            "case {0}: VariantAssignmentReason telemetry tag missing", caseId);
        reasonObj.Should().BeOfType<VariantAssignmentReason>(
            "case {0}: VariantAssignmentReason telemetry tag must be VariantAssignmentReason", caseId);
        reasonObj!.ToString().Should().Be(expectedReason, "case {0}: assignmentReason", caseId);

        (variant?.Name).Should().Be(expectedVariantName, "case {0}: variantName", caseId);

        if (expected.TryGetProperty("configurationValue", out var expectedConfig) && expectedConfig.ValueKind != JsonValueKind.Null)
        {
            variant.Should().NotBeNull("case {0}: expected configurationValue requires a variant", caseId);
            var actualConfig = ConfigSectionToJsonNode(variant!.Configuration);
            JsonNode.DeepEquals(actualConfig, JsonNode.Parse(expectedConfig.GetRawText()))
                .Should().BeTrue("case {0}: configurationValue mismatch. expected={1} actual={2}",
                    caseId, expectedConfig.GetRawText(), actualConfig?.ToJsonString());
        }
        else if (expectedVariantName == null)
        {
            variant.Should().BeNull("case {0}: expected no variant", caseId);
        }
    }

    private static FeatureDefinition BuildFeatureDefinition(JsonElement feature)
    {
        var name = feature.GetProperty("name").GetString()
            ?? throw new InvalidOperationException("feature.name required");

        var enabledFor = new List<FeatureFilterConfiguration>();
        if (feature.TryGetProperty("enabledFor", out var enabledForNode) && enabledForNode.ValueKind == JsonValueKind.Array)
        {
            foreach (var filter in enabledForNode.EnumerateArray())
            {
                enabledFor.Add(new FeatureFilterConfiguration
                {
                    Name = filter.GetProperty("name").GetString() ?? string.Empty
                });
            }
        }

        var variants = new List<VariantDefinition>();
        if (feature.TryGetProperty("variants", out var variantsNode) && variantsNode.ValueKind == JsonValueKind.Array)
        {
            foreach (var variant in variantsNode.EnumerateArray())
            {
                var statusOverride = StatusOverride.None;
                if (variant.TryGetProperty("statusOverride", out var so) && so.ValueKind == JsonValueKind.String
                    && Enum.TryParse<StatusOverride>(so.GetString(), ignoreCase: true, out var parsed))
                {
                    statusOverride = parsed;
                }

                variants.Add(new VariantDefinition
                {
                    Name = variant.GetProperty("name").GetString() ?? string.Empty,
                    ConfigurationValue = BuildConfigurationValueSection(
                        variant.TryGetProperty("configurationValue", out var cv) ? JsonNode.Parse(cv.GetRawText()) : null)!,
                    StatusOverride = statusOverride
                });
            }
        }

        Allocation? allocation = null;
        if (feature.TryGetProperty("allocation", out var allocationNode) && allocationNode.ValueKind == JsonValueKind.Object)
        {
            allocation = new Allocation
            {
                DefaultWhenEnabled = allocationNode.TryGetProperty("defaultWhenEnabled", out var dwe) && dwe.ValueKind == JsonValueKind.String
                    ? dwe.GetString()
                    : null,
                DefaultWhenDisabled = allocationNode.TryGetProperty("defaultWhenDisabled", out var dwd) && dwd.ValueKind == JsonValueKind.String
                    ? dwd.GetString()
                    : null,
                Seed = allocationNode.TryGetProperty("seed", out var seed) && seed.ValueKind == JsonValueKind.String
                    ? seed.GetString()
                    : null,
                User = ReadUserAllocations(allocationNode),
                Group = ReadGroupAllocations(allocationNode),
                Percentile = ReadPercentileAllocations(allocationNode)
            };
        }

        return new FeatureDefinition
        {
            Name = name,
            RequirementType = RequirementType.Any,
            Status = FeatureStatus.Conditional,
            EnabledFor = enabledFor,
            Variants = variants,
            Allocation = allocation,
            Telemetry = new TelemetryConfiguration { Enabled = true }
        };
    }

    private static List<UserAllocation>? ReadUserAllocations(JsonElement allocationNode)
    {
        if (!allocationNode.TryGetProperty("user", out var userNode) || userNode.ValueKind != JsonValueKind.Array)
            return null;

        return userNode.EnumerateArray().Select(u => new UserAllocation
        {
            Variant = u.GetProperty("variant").GetString() ?? string.Empty,
            Users = u.TryGetProperty("users", out var users) && users.ValueKind == JsonValueKind.Array
                ? users.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
                : new List<string>()
        }).ToList();
    }

    private static List<GroupAllocation>? ReadGroupAllocations(JsonElement allocationNode)
    {
        if (!allocationNode.TryGetProperty("group", out var groupNode) || groupNode.ValueKind != JsonValueKind.Array)
            return null;

        return groupNode.EnumerateArray().Select(g => new GroupAllocation
        {
            Variant = g.GetProperty("variant").GetString() ?? string.Empty,
            Groups = g.TryGetProperty("groups", out var groups) && groups.ValueKind == JsonValueKind.Array
                ? groups.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()!).ToList()
                : new List<string>()
        }).ToList();
    }

    private static List<PercentileAllocation>? ReadPercentileAllocations(JsonElement allocationNode)
    {
        if (!allocationNode.TryGetProperty("percentile", out var percentileNode) || percentileNode.ValueKind != JsonValueKind.Array)
            return null;

        return percentileNode.EnumerateArray().Select(p => new PercentileAllocation
        {
            Variant = p.GetProperty("variant").GetString() ?? string.Empty,
            From = p.GetProperty("from").GetDouble(),
            To = p.GetProperty("to").GetDouble()
        }).ToList();
    }

    private static IConfigurationSection? BuildConfigurationValueSection(JsonNode? node)
    {
        if (node is null || node.GetValueKind() == JsonValueKind.Null)
            return null;

        var data = new Dictionary<string, string?>();
        FlattenJsonNode(node, "value", data);
        var config = new ConfigurationBuilder().AddInMemoryCollection(data).Build();
        return config.GetSection("value");
    }

    private static void FlattenJsonNode(JsonNode? node, string path, Dictionary<string, string?> data)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var property in obj)
                    FlattenJsonNode(property.Value, path + ":" + property.Key, data);
                break;
            case JsonArray array:
                for (var i = 0; i < array.Count; i++)
                    FlattenJsonNode(array[i], path + ":" + i, data);
                break;
            case JsonValue val:
                if (val.TryGetValue<bool>(out var b))
                    data[path] = b ? "true" : "false";
                else if (val.TryGetValue<long>(out var l))
                    data[path] = l.ToString(System.Globalization.CultureInfo.InvariantCulture);
                else if (val.TryGetValue<double>(out var d))
                    data[path] = d.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
                else if (val.TryGetValue<string>(out var s))
                    data[path] = s;
                else
                    data[path] = val.ToJsonString();
                break;
            default:
                data[path] = null;
                break;
        }
    }

    private static JsonNode? ConfigSectionToJsonNode(IConfigurationSection? section)
    {
        if (section is null)
            return null;

        var children = section.GetChildren().ToList();
        if (children.Count == 0)
            return section.Value is null ? null : InferScalarNode(section.Value);

        var isArray = children
            .Select((c, i) => c.Key == i.ToString(System.Globalization.CultureInfo.InvariantCulture))
            .All(match => match);

        if (isArray)
        {
            var array = new JsonArray();
            foreach (var child in children)
                array.Add(ConfigSectionToJsonNode(child));
            return array;
        }

        var obj = new JsonObject();
        foreach (var child in children)
            obj[child.Key] = ConfigSectionToJsonNode(child);
        return obj;
    }

    private static JsonValue InferScalarNode(string value)
    {
        if (bool.TryParse(value, out var b))
            return JsonValue.Create(b)!;
        if (long.TryParse(value, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out var l))
            return JsonValue.Create(l)!;
        if (double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var d))
            return JsonValue.Create(d)!;
        return JsonValue.Create(value)!;
    }

    private sealed class SingleFeatureDefinitionProvider : IFeatureDefinitionProvider
    {
        private readonly FeatureDefinition _definition;

        public SingleFeatureDefinitionProvider(FeatureDefinition definition) => _definition = definition;

        public Task<FeatureDefinition> GetFeatureDefinitionAsync(string featureName) =>
            Task.FromResult(string.Equals(featureName, _definition.Name, StringComparison.OrdinalIgnoreCase)
                ? _definition
                : null!);

#pragma warning disable CS1998
        public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
        {
            yield return _definition;
        }
#pragma warning restore CS1998
    }
}
