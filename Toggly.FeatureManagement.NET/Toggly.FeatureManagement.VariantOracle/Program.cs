// Toggly.FeatureManagement.VariantOracle
//
// Generates a language-neutral "gold" corpus of Microsoft.FeatureManagement
// variant-allocation outcomes (variant-allocator-corpus/cases.json at the repo
// root) by driving the *real* Microsoft.FeatureManagement.FeatureManager for
// every fixture. Other Toggly SDKs (Go, Java, Python, Node, ...) replay this
// corpus to verify their own variant allocators stay bit-for-bit compatible
// with Microsoft.FeatureManagement's assignment algorithm (user/group/
// percentile allocation, seed/hint hashing, status overrides, defaults).
//
// Ground truth is captured from the FeatureManager's own evaluation telemetry
// (the "FeatureFlag" ActivityEvent published by
// Microsoft.FeatureManagement.Telemetry.FeatureEvaluationTelemetry) rather
// than re-implemented locally, so "Enabled" and "VariantAssignmentReason" are
// exactly what the library computed - not a parallel reimplementation that
// could silently drift from the library's real behavior.
//
// Regenerate with:
//   dotnet run --project Toggly.FeatureManagement.NET/Toggly.FeatureManagement.VariantOracle

using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Microsoft.FeatureManagement.Telemetry;

// The FeatureManager only publishes evaluation telemetry as an
// System.Diagnostics.ActivityEvent when an ActivityListener is subscribed to
// its ActivitySource ("Microsoft.FeatureManagement") and requests full data.
// We register one listener up front and capture the most recent "FeatureFlag"
// event into this slot; cases are evaluated strictly sequentially so a single
// mutable slot is safe.
ActivityEvent? capturedEvent = null;

var listener = new ActivityListener
{
    ShouldListenTo = source => source.Name == "Microsoft.FeatureManagement",
    Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
    ActivityStopped = activity =>
    {
        foreach (var evt in activity.Events)
        {
            if (evt.Name == "FeatureFlag")
            {
                capturedEvent = evt;
            }
        }
    }
};

ActivitySource.AddActivityListener(listener);

var repoRoot = FindRepoRoot();
var outputDir = Path.Combine(repoRoot, "variant-allocator-corpus");
var outputPath = Path.Combine(outputDir, "cases.json");

Directory.CreateDirectory(outputDir);

var caseSpecs = BuildCaseSpecs();
var output = new JsonArray();

foreach (var spec in caseSpecs)
{
    var outcome = await EvaluateAsync(spec);
    output.Add(BuildCaseOutput(spec, outcome));
}

var jsonOptions = new JsonSerializerOptions { WriteIndented = true };
File.WriteAllText(outputPath, output.ToJsonString(jsonOptions) + Environment.NewLine);

Console.WriteLine($"Wrote {caseSpecs.Count} case(s) to {outputPath}");

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

async Task<EvalOutcome> EvaluateAsync(CaseSpec spec)
{
    var featureDefinition = BuildFeatureDefinition(spec);
    var provider = new SingleFeatureDefinitionProvider(featureDefinition);

    var manager = new FeatureManager(provider, new FeatureManagementOptions
    {
        IgnoreMissingFeatureFilters = true
    })
    {
        AssignerOptions = new TargetingEvaluationOptions { IgnoreCase = spec.IgnoreCase }
    };

    var targetingContext = new TargetingContext
    {
        UserId = spec.UserId,
        Groups = spec.Groups ?? new List<string>()
    };

    capturedEvent = null;

    // A single GetVariantAsync call triggers one full evaluation pass inside
    // FeatureManager (enabled-state + variant assignment together), so both
    // the returned Variant and the published telemetry event describe the
    // exact same evaluation.
    var variant = await manager.GetVariantAsync(spec.FeatureName, targetingContext);

    if (capturedEvent is null)
    {
        throw new InvalidOperationException($"No FeatureFlag telemetry event was captured for case '{spec.Id}'.");
    }

    var tags = capturedEvent.Value.Tags.ToDictionary(t => t.Key, t => t.Value);

    bool enabled = tags.TryGetValue("Enabled", out var enabledObj) && enabledObj is bool b && b;

    var reason = tags.TryGetValue("VariantAssignmentReason", out var reasonObj) && reasonObj is VariantAssignmentReason r
        ? r
        : VariantAssignmentReason.None;

    JsonNode? configurationValue = variant?.Configuration is { } section
        ? ConfigSectionToJsonNode(section)
        : null;

    return new EvalOutcome(variant?.Name, configurationValue, enabled, reason);
}

FeatureDefinition BuildFeatureDefinition(CaseSpec spec)
{
    return new FeatureDefinition
    {
        Name = spec.FeatureName,
        RequirementType = RequirementType.Any,
        Status = FeatureStatus.Conditional,
        EnabledFor = spec.EnabledFor
            .Select(name => new FeatureFilterConfiguration { Name = name })
            .ToList(),
        Variants = spec.Variants
            .Select(v => new VariantDefinition
            {
                Name = v.Name,
                ConfigurationValue = BuildConfigurationValueSection(v.ConfigurationValue)!,
                StatusOverride = v.StatusOverride
            })
            .ToList(),
        Allocation = spec.Allocation is null
            ? null
            : new Allocation
            {
                DefaultWhenEnabled = spec.Allocation.DefaultWhenEnabled,
                DefaultWhenDisabled = spec.Allocation.DefaultWhenDisabled,
                Seed = spec.Allocation.Seed,
                User = spec.Allocation.User?
                    .Select(u => new UserAllocation { Variant = u.Variant, Users = u.Users })
                    .ToList(),
                Group = spec.Allocation.Group?
                    .Select(g => new GroupAllocation { Variant = g.Variant, Groups = g.Groups })
                    .ToList(),
                Percentile = spec.Allocation.Percentile?
                    .Select(p => new PercentileAllocation { Variant = p.Variant, From = p.From, To = p.To })
                    .ToList()
            },
        // Telemetry must be enabled per-feature for FeatureManager to publish
        // the "FeatureFlag" ActivityEvent we rely on for ground truth.
        Telemetry = new TelemetryConfiguration { Enabled = true }
    };
}

// ---------------------------------------------------------------------------
// IConfigurationSection <-> JsonNode plumbing
//
// VariantDefinition.ConfigurationValue is an IConfigurationSection, so
// arbitrary JSON fixtures are flattened into ":"-delimited configuration
// keys (the same shape Microsoft.Extensions.Configuration.Json produces),
// then re-hydrated from the *actual* Variant.Configuration MF returns. This
// round-trip means the corpus's expected.configurationValue reflects what MF
// really produced, not merely an echo of the authored fixture.
// ---------------------------------------------------------------------------

IConfigurationSection? BuildConfigurationValueSection(JsonNode? node)
{
    if (node is null)
    {
        return null;
    }

    var data = new Dictionary<string, string?>();
    FlattenJsonNode(node, "value", data);

    var config = new ConfigurationBuilder()
        .AddInMemoryCollection(data)
        .Build();

    return config.GetSection("value");
}

void FlattenJsonNode(JsonNode? node, string path, Dictionary<string, string?> data)
{
    switch (node)
    {
        case JsonObject obj:
            foreach (var (key, value) in obj)
            {
                FlattenJsonNode(value, $"{path}:{key}", data);
            }
            break;

        case JsonArray arr:
            for (int i = 0; i < arr.Count; i++)
            {
                FlattenJsonNode(arr[i], $"{path}:{i}", data);
            }
            break;

        case JsonValue val:
            data[path] = ScalarNodeToConfigString(val);
            break;

        default:
            data[path] = null;
            break;
    }
}

string? ScalarNodeToConfigString(JsonValue val)
{
    if (val.TryGetValue<bool>(out var b))
    {
        return b ? "true" : "false";
    }

    if (val.TryGetValue<long>(out var l))
    {
        return l.ToString(CultureInfo.InvariantCulture);
    }

    if (val.TryGetValue<double>(out var d))
    {
        return d.ToString("R", CultureInfo.InvariantCulture);
    }

    if (val.TryGetValue<string>(out var s))
    {
        return s;
    }

    return val.ToJsonString();
}

JsonNode? ConfigSectionToJsonNode(IConfigurationSection section)
{
    var children = section.GetChildren().ToList();

    if (children.Count == 0)
    {
        return section.Value is null ? null : InferScalarNode(section.Value);
    }

    bool isArray = children
        .Select((c, i) => c.Key == i.ToString(CultureInfo.InvariantCulture))
        .All(match => match);

    if (isArray)
    {
        var arr = new JsonArray();
        foreach (var child in children)
        {
            arr.Add(ConfigSectionToJsonNode(child));
        }
        return arr;
    }

    var obj = new JsonObject();
    foreach (var child in children)
    {
        obj[child.Key] = ConfigSectionToJsonNode(child);
    }
    return obj;
}

JsonNode InferScalarNode(string value)
{
    // Best-effort scalar typing for round-tripping through the string-typed
    // configuration system. Fixtures deliberately avoid values that are
    // ambiguous under this inference (e.g. numeric- or boolean-looking
    // strings that are meant to stay strings).
    if (bool.TryParse(value, out var b))
    {
        return JsonValue.Create(b);
    }

    if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l))
    {
        return JsonValue.Create(l);
    }

    if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
    {
        return JsonValue.Create(d);
    }

    return JsonValue.Create(value);
}

// ---------------------------------------------------------------------------
// Corpus JSON assembly
// ---------------------------------------------------------------------------

JsonObject BuildCaseOutput(CaseSpec spec, EvalOutcome outcome)
{
    var featureObj = new JsonObject
    {
        ["name"] = spec.FeatureName,
        ["enabledFor"] = new JsonArray(spec.EnabledFor
            .Select(name => (JsonNode)new JsonObject { ["name"] = name })
            .ToArray()),
        ["variants"] = new JsonArray(spec.Variants
            .Select(v => (JsonNode)new JsonObject
            {
                ["name"] = v.Name,
                ["configurationValue"] = v.ConfigurationValue?.DeepClone(),
                ["statusOverride"] = v.StatusOverride.ToString()
            })
            .ToArray()),
        ["allocation"] = spec.Allocation is null ? null : BuildAllocationOutput(spec.Allocation)
    };

    var targetingObj = new JsonObject
    {
        ["userId"] = spec.UserId,
        ["groups"] = new JsonArray((spec.Groups ?? new List<string>())
            .Select(g => (JsonNode)g)
            .ToArray())
    };

    var expectedObj = new JsonObject
    {
        ["variantName"] = outcome.VariantName,
        ["configurationValue"] = outcome.ConfigurationValue?.DeepClone(),
        ["enabled"] = outcome.Enabled,
        ["assignmentReason"] = outcome.Reason.ToString()
    };

    var root = new JsonObject
    {
        ["id"] = spec.Id,
        ["feature"] = featureObj,
        ["targeting"] = targetingObj,
        ["expected"] = expectedObj
    };

    if (spec.IgnoreCase)
    {
        // Additive field (not in the minimal schema example): drives
        // TargetingEvaluationOptions.IgnoreCase for this case only. Defaults
        // to false when omitted. See variant-allocator-corpus/README.md.
        root["ignoreCase"] = true;
    }

    return root;
}

JsonObject BuildAllocationOutput(AllocationSpec allocation)
{
    return new JsonObject
    {
        ["defaultWhenEnabled"] = allocation.DefaultWhenEnabled,
        ["defaultWhenDisabled"] = allocation.DefaultWhenDisabled,
        ["seed"] = allocation.Seed,
        ["user"] = allocation.User is null
            ? null
            : new JsonArray(allocation.User
                .Select(u => (JsonNode)new JsonObject
                {
                    ["variant"] = u.Variant,
                    ["users"] = new JsonArray(u.Users.Select(x => (JsonNode)x).ToArray())
                })
                .ToArray()),
        ["group"] = allocation.Group is null
            ? null
            : new JsonArray(allocation.Group
                .Select(g => (JsonNode)new JsonObject
                {
                    ["variant"] = g.Variant,
                    ["groups"] = new JsonArray(g.Groups.Select(x => (JsonNode)x).ToArray())
                })
                .ToArray()),
        ["percentile"] = allocation.Percentile is null
            ? null
            : new JsonArray(allocation.Percentile
                .Select(p => (JsonNode)new JsonObject
                {
                    ["variant"] = p.Variant,
                    ["from"] = p.From,
                    ["to"] = p.To
                })
                .ToArray())
    };
}

// ---------------------------------------------------------------------------
// Repo-root resolution
//
// `dotnet run` does not guarantee the process working directory equals the
// project directory, so we walk up from AppContext.BaseDirectory until we
// find the folder that contains this very project (a stable, unambiguous
// anchor for the Toggly.FeatureManagement repo root).
// ---------------------------------------------------------------------------

string FindRepoRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);

    while (dir is not null)
    {
        var candidate = Path.Combine(dir.FullName, "Toggly.FeatureManagement.NET", "Toggly.FeatureManagement.VariantOracle");
        if (Directory.Exists(candidate))
        {
            return dir.FullName;
        }
        dir = dir.Parent;
    }

    throw new DirectoryNotFoundException($"Could not locate the Toggly.FeatureManagement repo root from '{AppContext.BaseDirectory}'.");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

List<CaseSpec> BuildCaseSpecs()
{
    JsonNode J(string json) => JsonNode.Parse(json)!;

    return new List<CaseSpec>
    {
        // User allocation: direct match.
        new CaseSpec(
            Id: "user-match-basic",
            FeatureName: "checkout-flow",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"color":"blue"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"color":"green"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "B",
                DefaultWhenDisabled: null,
                Seed: null,
                User: new() { new UserAllocationSpec("A", new() { "alice", "bob" }) },
                Group: null,
                Percentile: null),
            UserId: "alice",
            Groups: new(),
            IgnoreCase: false),

        // User allocation: no match falls through to defaultWhenEnabled.
        new CaseSpec(
            Id: "user-no-match-falls-back-to-default-when-enabled",
            FeatureName: "checkout-flow-user-fallback",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"color":"blue"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"color":"green"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "B",
                DefaultWhenDisabled: null,
                Seed: null,
                User: new() { new UserAllocationSpec("A", new() { "alice", "bob" }) },
                Group: null,
                Percentile: null),
            UserId: "carol",
            Groups: new(),
            IgnoreCase: false),

        // Group allocation: direct match.
        new CaseSpec(
            Id: "group-match-basic",
            FeatureName: "beta-banner",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"show":false}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"show":true}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "A",
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: new() { new GroupAllocationSpec("B", new() { "beta-testers" }) },
                Percentile: null),
            UserId: "dave",
            Groups: new() { "beta-testers", "other-group" },
            IgnoreCase: false),

        // Group allocation: no match falls through to defaultWhenEnabled.
        new CaseSpec(
            Id: "group-no-match-falls-back-to-default-when-enabled",
            FeatureName: "beta-banner-group-fallback",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"show":false}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"show":true}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "A",
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: new() { new GroupAllocationSpec("B", new() { "beta-testers" }) },
                Percentile: null),
            UserId: "erin",
            Groups: new() { "some-other-group" },
            IgnoreCase: false),

        // Percentile allocation with the library's implicit default seed
        // ("allocation\n{featureName}"). Two users cover both buckets across
        // the two cases below (whichever real bucket each hashes into).
        new CaseSpec(
            Id: "percentile-default-seed-user-1",
            FeatureName: "gradual-rollout",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tier":"control"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"tier":"treatment"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: null,
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: null,
                Percentile: new()
                {
                    new PercentileAllocationSpec("A", 0, 50),
                    new PercentileAllocationSpec("B", 50, 100)
                }),
            UserId: "percentile-user-1",
            Groups: new(),
            IgnoreCase: false),

        new CaseSpec(
            Id: "percentile-default-seed-user-2",
            FeatureName: "gradual-rollout",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tier":"control"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"tier":"treatment"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: null,
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: null,
                Percentile: new()
                {
                    new PercentileAllocationSpec("A", 0, 50),
                    new PercentileAllocationSpec("B", 50, 100)
                }),
            UserId: "percentile-user-7",
            Groups: new(),
            IgnoreCase: false),

        // Percentile allocation with an explicit custom seed, so the hashed
        // context id is "{userId}\n{seed}" instead of the implicit default.
        new CaseSpec(
            Id: "percentile-custom-seed",
            FeatureName: "gradual-rollout-custom-seed",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tier":"control"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"tier":"treatment"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: null,
                DefaultWhenDisabled: null,
                Seed: "campaign-42",
                User: null,
                Group: null,
                Percentile: new()
                {
                    new PercentileAllocationSpec("A", 0, 50),
                    new PercentileAllocationSpec("B", 50, 100)
                }),
            UserId: "percentile-user-3",
            Groups: new(),
            IgnoreCase: false),

        // Percentile "to == 100" edge: TargetingEvaluator special-cases
        // to == 100 as an inclusive-from, unbounded-above match, so this
        // single bucket always matches regardless of the computed hash.
        new CaseSpec(
            Id: "percentile-to-100-edge-always-matches",
            FeatureName: "single-bucket-rollout",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tier":"everyone"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: null,
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: null,
                Percentile: new()
                {
                    new PercentileAllocationSpec("A", 0, 100)
                }),
            UserId: "any-user",
            Groups: new(),
            IgnoreCase: false),

        // defaultWhenEnabled with no user/group/percentile allocation at all.
        new CaseSpec(
            Id: "default-when-enabled-no-targeting-rules",
            FeatureName: "simple-default-enabled",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"plan":"free"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"plan":"paid"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "A",
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: null,
                Percentile: null),
            UserId: "frank",
            Groups: new(),
            IgnoreCase: false),

        // defaultWhenDisabled: feature is off, so User/Group/Percentile never
        // run; the disabled-side default variant is assigned directly.
        new CaseSpec(
            Id: "default-when-disabled-feature-off",
            FeatureName: "simple-default-disabled",
            EnabledFor: new(),
            Variants: new()
            {
                new VariantSpec("A", J("""{"plan":"free"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"plan":"paid"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "A",
                DefaultWhenDisabled: "B",
                Seed: null,
                User: null,
                Group: null,
                Percentile: null),
            UserId: "gina",
            Groups: new(),
            IgnoreCase: false),

        // Case-insensitive user targeting: TargetingEvaluationOptions.IgnoreCase
        // lower-cases both the configured user list and the incoming user id
        // before comparing.
        new CaseSpec(
            Id: "case-insensitive-user-match",
            FeatureName: "ci-user-match",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tag":"targeted"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"tag":"default"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "B",
                DefaultWhenDisabled: null,
                Seed: null,
                User: new() { new UserAllocationSpec("A", new() { "User1" }) },
                Group: null,
                Percentile: null),
            UserId: "user1",
            Groups: new(),
            IgnoreCase: true),

        // Control for the case above: the same mismatched-case user id does
        // NOT match without IgnoreCase, and falls back to the default.
        new CaseSpec(
            Id: "case-sensitive-user-no-match-falls-back-to-default",
            FeatureName: "cs-user-no-match",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tag":"targeted"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"tag":"default"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "B",
                DefaultWhenDisabled: null,
                Seed: null,
                User: new() { new UserAllocationSpec("A", new() { "User1" }) },
                Group: null,
                Percentile: null),
            UserId: "user1",
            Groups: new(),
            IgnoreCase: false),

        // No allocation at all (feature enabled): MF still reports
        // VariantAssignmentReason.DefaultWhenEnabled, but no variant is
        // actually assigned because there is no Allocation.DefaultWhenEnabled
        // to resolve against.
        new CaseSpec(
            Id: "no-allocation-enabled-yields-null-variant",
            FeatureName: "no-allocation-enabled",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"x":1}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"x":2}"""), StatusOverride.None)
            },
            Allocation: null,
            UserId: "henry",
            Groups: new(),
            IgnoreCase: false),

        // No allocation at all (feature disabled): mirrors the case above but
        // reports VariantAssignmentReason.DefaultWhenDisabled with a null
        // variant, and Enabled == false.
        new CaseSpec(
            Id: "no-allocation-disabled-yields-null-variant",
            FeatureName: "no-allocation-disabled",
            EnabledFor: new(),
            Variants: new()
            {
                new VariantSpec("A", J("""{"x":1}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"x":2}"""), StatusOverride.None)
            },
            Allocation: null,
            UserId: "iris",
            Groups: new(),
            IgnoreCase: false),

        // statusOverride: Enabled forces an otherwise-disabled feature to
        // report Enabled == true once that variant is assigned.
        new CaseSpec(
            Id: "status-override-enabled-flips-disabled-feature",
            FeatureName: "status-override-enabled",
            EnabledFor: new(),
            Variants: new()
            {
                new VariantSpec("Off", J("""{"killSwitch":true}"""), StatusOverride.Enabled)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: null,
                DefaultWhenDisabled: "Off",
                Seed: null,
                User: null,
                Group: null,
                Percentile: null),
            UserId: "jack",
            Groups: new(),
            IgnoreCase: false),

        // statusOverride: Disabled forces an otherwise-enabled feature to
        // report Enabled == false once that variant is assigned.
        new CaseSpec(
            Id: "status-override-disabled-flips-enabled-feature",
            FeatureName: "status-override-disabled",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("On", J("""{"killSwitch":false}"""), StatusOverride.Disabled)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "On",
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: null,
                Percentile: null),
            UserId: "kim",
            Groups: new(),
            IgnoreCase: false),

        // Empty targeting context (no userId, no groups): user/group/
        // percentile allocation can never match, so this exercises
        // defaultWhenEnabled with a bare TargetingContext.
        new CaseSpec(
            Id: "empty-targeting-context-uses-default-when-enabled",
            FeatureName: "empty-targeting-default",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new()
            {
                new VariantSpec("A", J("""{"tag":"fallback"}"""), StatusOverride.None),
                new VariantSpec("B", J("""{"tag":"other"}"""), StatusOverride.None)
            },
            Allocation: new AllocationSpec(
                DefaultWhenEnabled: "A",
                DefaultWhenDisabled: null,
                Seed: null,
                User: null,
                Group: null,
                Percentile: null),
            UserId: null,
            Groups: new(),
            IgnoreCase: false),

        // Feature with zero variants: the variant-assignment pipeline never
        // runs at all, so no variant is assigned and the assignment reason
        // stays at its default, "None".
        new CaseSpec(
            Id: "no-variants-defined-reason-is-none",
            FeatureName: "no-variants-feature",
            EnabledFor: new() { "AlwaysOn" },
            Variants: new(),
            Allocation: null,
            UserId: "liam",
            Groups: new(),
            IgnoreCase: false)
    };
}

// ---------------------------------------------------------------------------
// Fixture / outcome models
// ---------------------------------------------------------------------------

sealed record CaseSpec(
    string Id,
    string FeatureName,
    List<string> EnabledFor,
    List<VariantSpec> Variants,
    AllocationSpec? Allocation,
    string? UserId,
    List<string>? Groups,
    bool IgnoreCase);

sealed record VariantSpec(string Name, JsonNode? ConfigurationValue, StatusOverride StatusOverride);

sealed record AllocationSpec(
    string? DefaultWhenEnabled,
    string? DefaultWhenDisabled,
    string? Seed,
    List<UserAllocationSpec>? User,
    List<GroupAllocationSpec>? Group,
    List<PercentileAllocationSpec>? Percentile);

sealed record UserAllocationSpec(string Variant, List<string> Users);

sealed record GroupAllocationSpec(string Variant, List<string> Groups);

sealed record PercentileAllocationSpec(string Variant, double From, double To);

sealed record EvalOutcome(string? VariantName, JsonNode? ConfigurationValue, bool Enabled, VariantAssignmentReason Reason);

// ---------------------------------------------------------------------------
// Minimal in-memory feature definition provider
// ---------------------------------------------------------------------------

sealed class SingleFeatureDefinitionProvider : IFeatureDefinitionProvider
{
    private readonly FeatureDefinition _definition;

    public SingleFeatureDefinitionProvider(FeatureDefinition definition)
    {
        _definition = definition;
    }

    public Task<FeatureDefinition> GetFeatureDefinitionAsync(string featureName)
    {
        return Task.FromResult(string.Equals(featureName, _definition.Name, StringComparison.Ordinal)
            ? _definition
            : null!);
    }

    public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
    {
        yield return _definition;
        await Task.CompletedTask;
    }
}
