using Xunit;
using Toggly.FeatureManagement.Client;
namespace ClientTests;
public class Basics
{
    [Fact]
    public async Task OfflineDefaultsAndLocalPrerequisites()
    {
        await using var client = new TogglyClient(new()
        {
            Defaults = new Dictionary<string, bool> { { "on", true } },
            LocalGates = new Dictionary<string, Func<bool>> { { "on", () => false } }
        }, new HttpClient(), new Verifier());
        await client.InitializeAsync();
        Assert.True(client.IsReady);
        Assert.False(client.IsEnabled("on"));
        Assert.False(client.IsEnabled("missing"));
        Assert.True(client.Evaluate(["missing"], negate: true));
    }
}
internal sealed class Verifier : ISignatureVerifier
{
    public ValueTask<bool> VerifyAsync(string definitionsJson, long timestamp, string signature, string keyId, string jwksJson, CancellationToken cancellationToken = default) => ValueTask.FromResult(true);
}
