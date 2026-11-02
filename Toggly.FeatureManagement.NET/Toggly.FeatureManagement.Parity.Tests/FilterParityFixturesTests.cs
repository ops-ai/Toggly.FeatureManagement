#nullable enable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Moq;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Data;
using Toggly.FeatureManagement.Filters;
using Toggly.FeatureManagement.Web.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Parity.Tests;

/// <summary>
/// Loads golden fixtures from docs/filter-parity/fixtures and evaluates them with the
/// registered .NET FeatureManager + Toggly/Web filters (production registration semantics).
/// </summary>
public class FilterParityFixturesTests
{
    private static readonly HashSet<string> RequiredIds = new(StringComparer.Ordinal)
    {
        "browser-family-match",
        "browser-family-miss",
        "browser-language-match",
        "country-from-request",
        "country-from-cf-ipcountry",
        "device-type-match",
        "os-match",
        "user-claims-match",
        "user-claims-miss",
        "targeting-groups-match",
        "percentage-missing-fail-closed",
        "percentage-zero-fail-closed",
        "unknown-filter-fail-closed",
    };

    /// <summary>
    /// Cases that diverge from the shared filter-parity contract under production .NET settings.
    /// Do not change evaluation behavior to make these pass — document in the PR instead.
    /// </summary>
    private static readonly Dictionary<string, string> KnownFailures = new(StringComparer.Ordinal)
    {
        // Production AddTogglyFeatureManagement sets IgnoreMissingFeatureFilters=false, so unknown
        // filters throw rather than returning false as the shared contract expects.
        ["unknown-filter-fail-closed"] =
            "Production IgnoreMissingFeatureFilters=false throws on unknown filters; shared contract expects fail-closed false.",
    };

    public static IEnumerable<object[]> FixtureCases()
    {
        var dir = SharedFixturePaths.ResolveFilterParityFixturesDir();
        foreach (var path in Directory.EnumerateFiles(dir, "*.json").OrderBy(p => p, StringComparer.Ordinal))
        {
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var id = document.RootElement.GetProperty("id").GetString() ?? Path.GetFileNameWithoutExtension(path);
            yield return new object[] { id, path };
        }
    }

    [Fact]
    public void LoadsRequiredWave1Cases()
    {
        var dir = SharedFixturePaths.ResolveFilterParityFixturesDir();
        Directory.Exists(dir).Should().BeTrue("docs/filter-parity/fixtures must be present");

        var ids = Directory.EnumerateFiles(dir, "*.json")
            .Select(path =>
            {
                using var document = JsonDocument.Parse(File.ReadAllText(path));
                return document.RootElement.GetProperty("id").GetString()!;
            })
            .ToHashSet(StringComparer.Ordinal);

        foreach (var required in RequiredIds)
            ids.Should().Contain(required, "missing fixture {0}", required);
    }

    [Theory]
    [MemberData(nameof(FixtureCases))]
    public async Task GoldenFixture_EvaluatesAgainstDotNetFilters(string fixtureId, string fixturePath)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(fixturePath));
        var root = document.RootElement;
        var description = root.TryGetProperty("description", out var desc) ? desc.GetString() : fixtureId;
        var expected = root.GetProperty("expected").GetBoolean();

        if (KnownFailures.TryGetValue(fixtureId, out var reason))
        {
            // Still exercise the evaluator so regressions elsewhere stay visible; assert the known divergence.
            var (actual, error) = await EvaluateFixtureAsync(root);
            if (error != null)
            {
                Assert.True(true, $"Known failure '{fixtureId}': {reason} (threw: {error.GetType().Name})");
                return;
            }

            actual.Should().NotBe(expected,
                "known failure '{0}' was expected to diverge ({1}), but matched expected={2}",
                fixtureId, reason, expected);
            return;
        }

        var (result, evaluateError) = await EvaluateFixtureAsync(root);
        evaluateError.Should().BeNull("fixture {0} ({1}) threw {2}: {3}", fixtureId, description, evaluateError?.GetType().Name, evaluateError?.Message);
        result.Should().Be(expected, "fixture {0}: {1}", fixtureId, description);
    }

    private static async Task<(bool? Result, Exception? Error)> EvaluateFixtureAsync(JsonElement root)
    {
        try
        {
            var featureKey = root.GetProperty("featureKey").GetString()
                ?? throw new InvalidOperationException("fixture missing featureKey");
            var requirementType = RequirementType.Any;
            if (root.TryGetProperty("requirementType", out var req) && req.ValueKind == JsonValueKind.String
                && Enum.TryParse<RequirementType>(req.GetString(), ignoreCase: true, out var parsedRequirement))
            {
                requirementType = parsedRequirement;
            }

            var filters = new List<FeatureFilter>();
            if (root.TryGetProperty("filters", out var filterArray) && filterArray.ValueKind == JsonValueKind.Array)
            {
                foreach (var filterNode in filterArray.EnumerateArray())
                {
                    var name = filterNode.GetProperty("name").GetString() ?? string.Empty;
                    var parameters = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    if (filterNode.TryGetProperty("parameters", out var paramsNode) && paramsNode.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var property in paramsNode.EnumerateObject())
                            parameters[property.Name] = JsonElementToParameterString(property.Value);
                    }

                    filters.Add(new FeatureFilter { Name = name, Parameters = parameters });
                }
            }

            var model = new FeatureDefinitionModel
            {
                FeatureKey = featureKey,
                RequirementType = requirementType,
                Filters = filters
            };
            var definition = TogglyFeatureProvider.BuildFeatureDefinition(model);

            var identity = TryGetString(root, "context", "identity");
            var groups = TryGetStringArray(root, "context", "groups");
            var claims = TryGetStringMap(root, "context", "claims");
            var requestCountry = TryGetString(root, "context", "request", "country");
            var userAgent = TryGetString(root, "context", "request", "userAgent");
            var acceptLanguage = TryGetString(root, "context", "request", "acceptLanguage");
            var httpHeaders = TryGetStringMap(root, "httpHeaders");

            var httpContext = new DefaultHttpContext();
            if (!string.IsNullOrEmpty(userAgent))
                httpContext.Request.Headers["User-Agent"] = userAgent;
            if (!string.IsNullOrEmpty(acceptLanguage))
                httpContext.Request.Headers["Accept-Language"] = acceptLanguage;

            // CountryFilter reads CDN headers only. Map EvalContext.request.country the same way
            // other SDKs treat an already-resolved request.country (synthesize CF-IPCountry).
            if (!string.IsNullOrEmpty(requestCountry) && (httpHeaders == null || !httpHeaders.Keys.Any(k =>
                    string.Equals(k, "cf-ipcountry", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(k, "x-vercel-ip-country", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(k, "cloudfront-viewer-country", StringComparison.OrdinalIgnoreCase))))
            {
                httpContext.Request.Headers["CF-IPCountry"] = requestCountry;
            }

            if (httpHeaders != null)
            {
                foreach (var header in httpHeaders)
                    httpContext.Request.Headers[header.Key] = header.Value;
            }

            if (claims != null && claims.Count > 0)
            {
                var claimList = claims.Select(pair => new Claim(pair.Key, pair.Value)).ToList();
                httpContext.User = new ClaimsPrincipal(new ClaimsIdentity(claimList, "parity"));
            }

            var httpAccessor = new HttpContextAccessor { HttpContext = httpContext };
            var targetingAccessor = new Mock<ITargetingContextAccessor>();
            targetingAccessor.Setup(a => a.GetContextAsync()).ReturnsAsync(new TargetingContext
            {
                UserId = identity,
                Groups = groups ?? Array.Empty<string>()
            });

            var services = new ServiceCollection();
            services.AddLogging();
            services.AddSingleton<IHttpContextAccessor>(httpAccessor);
            services.AddSingleton(targetingAccessor.Object);
            services.AddSingleton<IFeatureDefinitionModelProvider>(new StaticModelProvider(model));
            services.AddSingleton<IFeatureDefinitionProvider>(new SingleFeatureDefinitionProvider(definition));

            // Mirror AddTogglyFeatureManagement + AddTogglyWeb filter registration without network/DI host extras.
            services.AddFeatureManagement()
                .AddFeatureFilter<TimeWindowFilter>()
                .AddFeatureFilter<ContextPropertyFilter>()
                .AddFeatureFilter<AlwaysOnFeatureFilter>()
                .AddFeatureFilter<TogglyPercentageFilter>()
                .AddFeatureFilter<TogglyTargetingFilter>()
                .AddFeatureFilter<BrowserFamilyFilter>()
                .AddFeatureFilter<BrowserLanguageFilter>()
                .AddFeatureFilter<CountryFilter>()
                .AddFeatureFilter<DeviceTypeFilter>()
                .AddFeatureFilter<OSFilter>()
                .AddFeatureFilter<UserClaimsFilter>();

            // Match production: remove stock Percentage/Targeting so Toggly filters win.
            RemoveFeatureFilter(services, typeof(PercentageFilter));
            RemoveFeatureFilter(services, typeof(TargetingFilter));

            // Production default: fail closed by throwing on unknown filters.
            services.Configure<FeatureManagementOptions>(options =>
            {
                options.IgnoreMissingFeatureFilters = false;
            });

            using var provider = services.BuildServiceProvider();
            var manager = provider.GetRequiredService<IFeatureManager>();
            var enabled = await manager.IsEnabledAsync(featureKey);
            return (enabled, null);
        }
        catch (Exception ex)
        {
            return (null, ex);
        }
    }

    private static string JsonElementToParameterString(JsonElement value) =>
        value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => string.Empty,
            _ => value.GetRawText()
        };

    private static string? TryGetString(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        return current.ValueKind == JsonValueKind.String ? current.GetString() : null;
    }

    private static string[]? TryGetStringArray(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        if (current.ValueKind != JsonValueKind.Array)
            return null;

        return current.EnumerateArray()
            .Where(e => e.ValueKind == JsonValueKind.String)
            .Select(e => e.GetString()!)
            .ToArray();
    }

    private static Dictionary<string, string>? TryGetStringMap(JsonElement root, params string[] path)
    {
        var current = root;
        foreach (var segment in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current))
                return null;
        }

        if (current.ValueKind != JsonValueKind.Object)
            return null;

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in current.EnumerateObject())
        {
            if (property.Value.ValueKind == JsonValueKind.String)
                map[property.Name] = property.Value.GetString() ?? string.Empty;
            else
                map[property.Name] = property.Value.GetRawText();
        }

        return map;
    }

    private static void RemoveFeatureFilter(ServiceCollection services, Type implementationType)
    {
        var descriptors = services
            .Where(d => d.ServiceType == typeof(IFeatureFilterMetadata) && d.ImplementationType == implementationType)
            .ToList();
        foreach (var descriptor in descriptors)
            services.Remove(descriptor);
    }

    private sealed class StaticModelProvider : IFeatureDefinitionModelProvider
    {
        private readonly FeatureDefinitionModel _model;

        public StaticModelProvider(FeatureDefinitionModel model) => _model = model;

        public bool TryGetFeatureModel(string featureKey, out FeatureDefinitionModel? definition)
        {
            if (string.Equals(featureKey, _model.FeatureKey, StringComparison.OrdinalIgnoreCase))
            {
                definition = _model;
                return true;
            }

            definition = null;
            return false;
        }
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
