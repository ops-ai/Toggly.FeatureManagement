using System.Text;
using System.Text.Json;
using Toggly.CLI.Commands;
using Toggly.CLI.UnleashMigration;
using Xunit;

namespace Toggly.CLI.Tests;

public class UnleashMigrationCoverageTests
{
    [Fact]
    public void Mapper_UserWithId_EmptyUserIds_SkipsWithoutTargetingFilter()
    {
        var strategy = new UnleashStrategyDto
        {
            Name = "userWithId",
            Parameters = new Dictionary<string, string> { ["userIds"] = "" }
        };

        var result = UnleashStrategyMapper.Map([strategy]);

        Assert.Equal(UnleashMappingStatus.Skipped, result.Status);
        Assert.Empty(result.Filters);
        Assert.Contains("empty or missing userIds", result.Note);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    [InlineData(" , , ")]
    public void Mapper_UserWithId_MissingOrWhitespaceUserIds_SkipsWithoutTargetingFilter(string? userIds)
    {
        var parameters = userIds is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string> { ["userIds"] = userIds };

        var strategy = new UnleashStrategyDto
        {
            Name = "userWithId",
            Parameters = userIds is null ? null : parameters
        };

        var result = UnleashStrategyMapper.MapStrategy(strategy);

        Assert.Equal(UnleashMappingStatus.Skipped, result.Status);
        Assert.Empty(result.Filters);
        Assert.DoesNotContain(result.Filters, f => f.Name == "Targeting");
    }

    [Fact]
    public void BuildImportPlan_EmptyUserWithId_ImportsAsOff()
    {
        var features = new List<UnleashFeatureDto>
        {
            new()
            {
                Name = "empty-audience",
                Enabled = true,
                Strategies =
                [
                    new UnleashStrategyDto
                    {
                        Name = "userWithId",
                        Parameters = new Dictionary<string, string> { ["userIds"] = "" }
                    }
                ]
            }
        };

        var plan = MigrateCommands.BuildImportPlan(features);
        var item = Assert.Single(plan.Items);

        Assert.Equal(UnleashMappingStatus.Skipped, item.Status);
        Assert.False(item.Enabled);
        Assert.Empty(item.Filters);
        Assert.Contains("empty or missing userIds", item.Note);
        Assert.Contains("will import as disabled/off", item.Note);
    }

    [Fact]
    public void Parser_TopLevelArray_AndParseFileAndStream()
    {
        const string json = """
            [
              {
                "name": "array-flag",
                "enabled": true,
                "strategies": [
                  { "name": "default", "parameters": {}, "disabled": false }
                ]
              }
            ]
            """;

        var fromText = UnleashExportParser.Parse(json);
        Assert.Equal("top-level features array", fromText.AcceptedShape);
        Assert.Equal("array-flag", Assert.Single(fromText.Features).Name);

        using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
        var fromStream = UnleashExportParser.Parse(stream);
        Assert.Equal("top-level features array", fromStream.AcceptedShape);

        var path = Path.Combine(Path.GetTempPath(), "unleash-array-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(path, json);
        try
        {
            var fromFile = UnleashExportParser.ParseFile(path);
            Assert.Equal("top-level features array", fromFile.AcceptedShape);
            Assert.Equal("array-flag", Assert.Single(fromFile.Features).Name);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Parser_ObjectWithFeatures_NoVersion()
    {
        var parsed = UnleashExportParser.Parse("""
            {
              "features": [
                { "name": "plain", "enabled": true, "strategies": [] }
              ]
            }
            """);

        Assert.Equal("object with features array", parsed.AcceptedShape);
        Assert.Equal("plain", Assert.Single(parsed.Features).Name);
    }

    [Fact]
    public void Parser_UnrecognizedRoot_Throws()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => UnleashExportParser.Parse("42"));
        Assert.Contains("Unrecognized Unleash export root kind", ex.Message);
    }

    [Fact]
    public void Parser_MatchingEnvironmentSlice_IsCaseInsensitive()
    {
        var json = EnvScopedExport();
        var parsed = UnleashExportParser.Parse(json, "PRODUCTION");
        var feature = Assert.Single(parsed.Features);

        Assert.Null(feature.UnmatchedRequestedEnvironment);
        Assert.True(feature.Enabled);
        var strategy = Assert.Single(feature.Strategies!);
        Assert.Equal("userWithId", strategy.Name);
        Assert.Equal("alice", strategy.Parameters!["userIds"]);
    }

    [Fact]
    public void Parser_NoRequestedEnv_PrefersFeatureLevelStrategies()
    {
        var json = """
            {
              "features": [
                {
                  "name": "both",
                  "enabled": true,
                  "strategies": [
                    { "name": "default", "parameters": {}, "disabled": false }
                  ],
                  "environments": [
                    {
                      "name": "production",
                      "enabled": false,
                      "strategies": [
                        {
                          "name": "userWithId",
                          "parameters": { "userIds": "alice" },
                          "disabled": false
                        }
                      ]
                    }
                  ]
                }
              ]
            }
            """;

        var parsed = UnleashExportParser.Parse(json);
        var feature = Assert.Single(parsed.Features);
        Assert.Equal("default", Assert.Single(feature.Strategies!).Name);
    }

    [Fact]
    public void Parser_NoRequestedEnv_FallsBackToFirstEnvironmentSlice()
    {
        var json = EnvScopedExport();
        var parsed = UnleashExportParser.Parse(json);
        var feature = Assert.Single(parsed.Features);

        Assert.True(feature.Enabled);
        Assert.Equal("default", Assert.Single(feature.Strategies!).Name);
    }

    [Fact]
    public void Parser_EnvironmentSliceWithNullStrategies_KeepsFeatureStrategies()
    {
        var feature = new UnleashFeatureDto
        {
            Name = "keep-feature-strategies",
            Strategies =
            [
                new UnleashStrategyDto { Name = "default" }
            ],
            Environments =
            [
                new UnleashEnvironmentDto
                {
                    Name = "production",
                    Enabled = true,
                    Strategies = null
                }
            ]
        };

        var normalized = UnleashExportParser.NormalizeForEnvironment(feature, "production");
        Assert.True(normalized.Enabled);
        Assert.Equal("default", Assert.Single(normalized.Strategies!).Name);
    }

    [Fact]
    public void Mapper_IgnoresDisabledStrategies_AndNullCollection()
    {
        var disabled = new UnleashStrategyDto { Name = "default", Disabled = true };
        var mapped = UnleashStrategyMapper.Map([disabled]);
        Assert.Equal(UnleashMappingStatus.Skipped, mapped.Status);
        Assert.Empty(mapped.Filters);

        var empty = UnleashStrategyMapper.Map(null);
        Assert.Equal(UnleashMappingStatus.Skipped, empty.Status);
        Assert.Empty(empty.Filters);
    }

    [Fact]
    public void Mapper_UnsupportedStrategies_Skip()
    {
        foreach (var name in new[] { "remoteAddress", "hostname", "myPlugin" })
        {
            var result = UnleashStrategyMapper.MapStrategy(new UnleashStrategyDto { Name = name });
            Assert.Equal(UnleashMappingStatus.Skipped, result.Status);
            Assert.Empty(result.Filters);
        }
    }

    [Fact]
    public void Mapper_MixedMappedAndSkipped_IsPartial()
    {
        var result = UnleashStrategyMapper.Map(
        [
            new UnleashStrategyDto { Name = "default" },
            new UnleashStrategyDto { Name = "hostname" }
        ]);

        Assert.Equal(UnleashMappingStatus.Partial, result.Status);
        Assert.Single(result.Filters);
    }

    [Fact]
    public void Mapper_Constraints_MarkPartial()
    {
        var supported = UnleashStrategyMapper.MapStrategy(new UnleashStrategyDto
        {
            Name = "default",
            Constraints =
            [
                new UnleashConstraintDto { ContextName = "userId", Operator = "IN" }
            ]
        });
        Assert.Equal(UnleashMappingStatus.Partial, supported.Status);
        Assert.Contains("best-effort", supported.Note);

        var unsupported = UnleashStrategyMapper.MapStrategy(new UnleashStrategyDto
        {
            Name = "default",
            Constraints =
            [
                new UnleashConstraintDto { ContextName = "appVer", Operator = "SEMVER_GT" }
            ]
        });
        Assert.Equal(UnleashMappingStatus.Partial, unsupported.Status);
        Assert.Contains("unsupported constraint operator", unsupported.Note);
    }

    [Fact]
    public void Mapper_GradualRollout_SessionAndRandom_ArePartialPercentage()
    {
        var session = UnleashStrategyMapper.MapStrategy(new UnleashStrategyDto
        {
            Name = "gradualRolloutSessionId",
            Parameters = new Dictionary<string, string> { ["percentage"] = "40" }
        });
        Assert.Equal(UnleashMappingStatus.Partial, session.Status);
        Assert.Equal("Percentage", Assert.Single(session.Filters).Name);
        Assert.Contains("sessionId", session.Note);

        var random = UnleashStrategyMapper.MapStrategy(new UnleashStrategyDto
        {
            Name = "gradualRolloutRandom",
            Parameters = new Dictionary<string, string> { ["percentage"] = "not-a-number" }
        });
        Assert.Equal(UnleashMappingStatus.Partial, random.Status);
        Assert.Contains("random", random.Note);
        Assert.Equal(0d, Convert.ToDouble(Assert.Single(random.Filters).Parameters!["Value"]));
    }

    [Fact]
    public void Mapper_FlexibleRollout_UnsupportedStickinessAndGroupIdMismatch()
    {
        var result = UnleashStrategyMapper.Map(
            [
                new UnleashStrategyDto
                {
                    Name = "flexibleRollout",
                    Parameters = new Dictionary<string, string>
                    {
                        ["rollout"] = "150",
                        ["stickiness"] = "sessionId",
                        ["groupId"] = "other-group"
                    }
                }
            ],
            "feature-key");

        Assert.Equal(UnleashMappingStatus.Partial, result.Status);
        Assert.Contains("stickiness=sessionId unsupported", result.Note);
        Assert.Contains("groupId=other-group", result.Note);
        Assert.Contains(UnleashStrategyMapper.PercentageHashParityNote, result.Note);
        Assert.Equal(100d, Convert.ToDouble(Assert.Single(result.Filters).Parameters!["Value"]));
    }

    [Fact]
    public void Mapper_MapStrategy_NullThrows()
        => Assert.Throws<ArgumentNullException>(() => UnleashStrategyMapper.MapStrategy(null!));

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("userId", true)]
    [InlineData("default", true)]
    [InlineData("sessionId", false)]
    [InlineData("random", false)]
    [InlineData("customField", false)]
    public void Stickiness_IsStickinessSupported(string? mode, bool expected)
        => Assert.Equal(expected, UnleashStickiness.IsStickinessSupported(mode));

    [Fact]
    public void Stickiness_ResolveStickinessId_Modes()
    {
        Assert.Equal("u1", UnleashStickiness.ResolveStickinessId("userId", "u1", "s1"));
        Assert.Null(UnleashStickiness.ResolveStickinessId("userId", null, "s1"));
        Assert.Equal("u1", UnleashStickiness.ResolveStickinessId("default", "u1", "s1"));
        Assert.Equal("s1", UnleashStickiness.ResolveStickinessId(null, null, "s1"));
        Assert.Null(UnleashStickiness.ResolveStickinessId("default", null, null));
        Assert.Null(UnleashStickiness.ResolveStickinessId("sessionId", "u1", "s1"));
        Assert.Null(UnleashStickiness.ResolveStickinessId("random", "u1", "s1"));
    }

    [Fact]
    public void Stickiness_NormalizedStrategyValue_MatchesUnleashVectorAndRolloutBounds()
    {
        // Unleash client-go / node: murmur3_x86_32("gr1:123") % 100 + 1 == 73
        Assert.Equal(73, UnleashStickiness.NormalizedStrategyValue("123", "gr1"));
        Assert.False(UnleashStickiness.IsInRollout("123", "gr1", 0));
        Assert.False(UnleashStickiness.IsInRollout("123", "gr1", 72));
        Assert.True(UnleashStickiness.IsInRollout("123", "gr1", 73));
        Assert.True(UnleashStickiness.IsInRollout("123", "gr1", 100));
        Assert.Throws<ArgumentNullException>(() => UnleashStickiness.NormalizedStrategyValue(null!, "g"));
        Assert.Throws<ArgumentOutOfRangeException>(() => UnleashStickiness.NormalizedStrategyValue("id", "g", 0));
    }

    [Fact]
    public void Stickiness_Murmur3_CoversTailLengths()
    {
        _ = UnleashStickiness.Murmur3X86_32("a"u8);
        _ = UnleashStickiness.Murmur3X86_32("ab"u8);
        _ = UnleashStickiness.Murmur3X86_32("abc"u8);
        _ = UnleashStickiness.Murmur3X86_32("abcd"u8);
        Assert.NotEqual(
            UnleashStickiness.Murmur3X86_32("abc"u8),
            UnleashStickiness.Murmur3X86_32("abcd"u8));
    }

    [Fact]
    public void BuildImportPlan_SkipsBlankNames_AndNotesVariantsAndDisabled()
    {
        var features = new List<UnleashFeatureDto>
        {
            new() { Name = "  " },
            new()
            {
                Name = "with-variants",
                Enabled = true,
                Strategies = [new UnleashStrategyDto { Name = "default" }],
                Variants = [new UnleashVariantDto { Name = "on" }]
            },
            new()
            {
                Name = "disabled-flag",
                Enabled = false,
                Strategies = [new UnleashStrategyDto { Name = "default" }]
            }
        };

        var plan = MigrateCommands.BuildImportPlan(features);
        Assert.Equal(2, plan.Items.Count);

        var variants = plan.Items.Single(i => i.FeatureKey == "with-variants");
        Assert.Equal(UnleashMappingStatus.Partial, variants.Status);
        Assert.Contains("variants not imported", variants.Note);
        Assert.NotEmpty(variants.Filters);

        var disabled = plan.Items.Single(i => i.FeatureKey == "disabled-flag");
        Assert.Empty(disabled.Filters);
        Assert.False(disabled.Enabled);
        Assert.Contains("disabled in Unleash", disabled.Note);

        var json = plan.Report.ToJson();
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(1, doc.RootElement.GetProperty("partialCount").GetInt32());
        Assert.Equal(1, doc.RootElement.GetProperty("mappedCount").GetInt32());
    }

    [Fact]
    public void CompatibilityReport_ToText_IncludesCounts()
    {
        var report = new UnleashCompatibilityReport();
        report.Add("a", UnleashMappingStatus.Mapped, "ok");
        report.Add("b", UnleashMappingStatus.Skipped, null!);
        var text = report.ToText();
        Assert.Contains("Mapped: 1", text);
        Assert.Contains("Skipped: 1", text);
        Assert.Contains("a — ok", text);
    }

    private static string EnvScopedExport() => """
        {
          "features": [
            {
              "name": "env-scoped",
              "enabled": true,
              "environments": [
                {
                  "name": "development",
                  "enabled": true,
                  "strategies": [
                    { "name": "default", "parameters": {}, "disabled": false }
                  ]
                },
                {
                  "name": "production",
                  "enabled": true,
                  "strategies": [
                    {
                      "name": "userWithId",
                      "parameters": { "userIds": "alice" },
                      "disabled": false
                    }
                  ]
                }
              ]
            }
          ]
        }
        """;
}
