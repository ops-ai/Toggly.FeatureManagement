using System.Net;
using System.Text.Json;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using Xunit;

namespace ClientTests;

/// <summary>
/// Exercises real flag evaluation against the signed evaluated-signed HTTP contract (mocked transport).
/// Covers boolean defs, entity rules, multi-flag Evaluate, and request query shape.
/// </summary>
public class FlagEvaluationContractTests
{
    [Fact]
    public async Task SignedBooleanAndEntityDefsEvaluateThroughIsEnabledAndEvaluate()
    {
        using var fixture = new SignedFixture();
        var defs = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["always_on"] = true,
            ["always_off"] = false,
            ["pro_plan"] = new
            {
                requirement = "all",
                rules = new[]
                {
                    new { property = "plan", op = "eq", type = "string", value = "pro" }
                }
            },
            ["beta_or_vip"] = new
            {
                requirement = "any",
                rules = new[]
                {
                    new { property = "tier", op = "eq", type = "string", value = "beta" },
                    new { property = "tags", op = "contains", type = "string[]", value = "vip" }
                }
            }
        });

        HttpRequestMessage? lastRequest = null;
        using var http = new HttpClient(new Handler((request, _) =>
        {
            lastRequest = request;
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(fixture.Envelope(defs))
            };
            response.Headers.TryAddWithoutValidation("X-Definitions-Revision", "contract-rev-1");
            return Task.FromResult(response);
        }));

        await using var client = new TogglyClient(new()
        {
            EnableTelemetry = false,
            AppKey = "public-app",
            Environment = "Production",
            TrustedJwks = fixture.Jwks,
            EnableLiveUpdates = false,
            Context = new("alice", ["beta"], new Dictionary<string, string> { ["role"] = "admin" })
        }, http, new Es256SignatureVerifier());

        await client.InitializeAsync();

        Assert.NotNull(lastRequest);
        var url = lastRequest!.RequestUri!;
        Assert.Equal("/evaluated-signed/public-app/Production", url.AbsolutePath);
        var query = url.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
        Assert.Contains("u=alice", query);
        Assert.Contains("g=beta", query);
        Assert.Contains("claim.role=admin", query);
        Assert.Equal("dotnet-client", lastRequest.Headers.GetValues("X-Toggly-Sdk").Single());

        Assert.True(client.IsReady);
        Assert.True(client.IsEnabled("always_on"));
        Assert.False(client.IsEnabled("always_off"));
        Assert.False(client.IsEnabled("missing_flag"));

        var pro = new EntityContext("Account", "acct-1", new Dictionary<string, object?> { ["plan"] = "pro" });
        var free = new EntityContext("Account", "acct-2", new Dictionary<string, object?> { ["plan"] = "free" });
        Assert.True(client.IsEnabled("pro_plan", pro));
        Assert.False(client.IsEnabled("pro_plan", free));
        Assert.False(client.IsEnabled("pro_plan"));

        var vip = new EntityContext("User", "u1", new Dictionary<string, object?>
        {
            ["tier"] = "standard",
            ["tags"] = new[] { "VIP", "early" }
        });
        var neither = new EntityContext("User", "u2", new Dictionary<string, object?>
        {
            ["tier"] = "standard",
            ["tags"] = new[] { "plain" }
        });
        Assert.True(client.IsEnabled("beta_or_vip", vip));
        Assert.False(client.IsEnabled("beta_or_vip", neither));

        Assert.True(client.Evaluate(["always_on", "always_off"], Requirement.Any));
        Assert.False(client.Evaluate(["always_on", "always_off"], Requirement.All));
        Assert.True(client.Evaluate(["always_off"], negate: true));
        Assert.True(client.Evaluate(["pro_plan"], entity: pro));
        Assert.False(client.Evaluate(["pro_plan"], entity: free));
    }

    [Fact]
    public async Task LocalGatesCannotEnableRemotelyDisabledFlags()
    {
        using var fixture = new SignedFixture();
        using var http = new HttpClient(new Handler((_, _) =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(fixture.Envelope("{\"remote_off\":false,\"remote_on\":true}"))
            };
            response.Headers.TryAddWithoutValidation("X-Definitions-Revision", "gate-rev");
            return Task.FromResult(response);
        }));

        await using var client = new TogglyClient(new()
        {
            EnableTelemetry = false,
            AppKey = "public-app",
            TrustedJwks = fixture.Jwks,
            EnableLiveUpdates = false,
            LocalGates = new Dictionary<string, Func<bool>>
            {
                ["remote_off"] = () => true,
                ["remote_on"] = () => false
            }
        }, http, new Es256SignatureVerifier());

        await client.InitializeAsync();
        Assert.False(client.IsEnabled("remote_off"));
        Assert.False(client.IsEnabled("remote_on"));
    }
}
