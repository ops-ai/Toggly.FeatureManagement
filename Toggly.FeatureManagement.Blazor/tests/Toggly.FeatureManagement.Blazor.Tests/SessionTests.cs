using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Xunit;

namespace Blazor.Tests;

public class SessionTests
{
    [Fact]
    public async Task BrowserDefaultsAndContextChangesAreIsolated()
    {
        await using var one = new BrowserFeatureSession(
            new TogglyClient(
                new()
                {
                    Defaults = new Dictionary<string, bool> { { "on", true } },
                    EnableLiveUpdates = false,
                },
                new HttpClient(),
                new RejectVerifier()
            )
        );
        await using var two = new BrowserFeatureSession(
            new TogglyClient(
                new()
                {
                    EnableLiveUpdates = false
                },
                new HttpClient(),
                new RejectVerifier()
            )
        );
        Assert.False(one.IsReady);
        await one.InitializeAsync();
        await two.InitializeAsync();
        Assert.True(await one.EvaluateAsync(["on"]));
        Assert.False(await two.EvaluateAsync(["on"]));
        Assert.True(await one.EvaluateAsync(["on", "off"], Requirement.Any));
        Assert.False(await one.EvaluateAsync(["on", "off"]));
        Assert.True(await one.EvaluateAsync(["off"], negate: true));
        await one.SetContextAsync(
            new("alice", ["vip"], new Dictionary<string, string> { { "plan", "pro" } })
        );
        Assert.True(await one.EvaluateAsync(["on"]));
        var changes = 0;
        one.Changed += (_, _) => changes++;
        await one.RefreshAsync();
        Assert.Equal(1, changes);
    }

    private sealed class RejectVerifier : ISignatureVerifier
    {
        public ValueTask<bool> VerifyAsync(
            string a,
            long b,
            string c,
            string d,
            string e,
            CancellationToken ct = default
        ) => ValueTask.FromResult(false);
    }
}
