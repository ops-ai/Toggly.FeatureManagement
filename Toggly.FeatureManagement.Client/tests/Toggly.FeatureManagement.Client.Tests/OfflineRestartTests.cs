using System.Net;
using System.Text.Json.Nodes;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using Xunit;

namespace ClientTests;

public sealed class OfflineRestartTests
{
    [Fact]
    public async Task HistoricalContextKeysCannotOverrideKeysAlreadyObservedByRunningClient()
    {
        using var oldKey = new SignedFixture();
        using var newKey = new SignedFixture();
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var rotated = false;
        var offline = false;
        var options = new TogglyClientOptions { AppKey = "public", Context = new("alice"), EnableLiveUpdates = false };
        using var http = new HttpClient(new Handler((request, _) =>
        {
            if (offline)
                throw new HttpRequestException("offline");
            var key = rotated ? newKey : oldKey;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(request.RequestUri!.AbsolutePath.Contains("jwks") ? key.Jwks : key.Envelope("{\"enabled\":true}"))
            });
        }));
        try
        {
            await using (var client = DesktopClient.Create(options, http, directory))
            {
                await client.InitializeAsync();
                rotated = true;
                await client.SetContextAsync(new("bob"));
                Assert.True(client.IsEnabled("enabled"));
                offline = true;
                await client.SetContextAsync(new("alice"));
                Assert.False(client.IsEnabled("enabled"));
            }
            // A fresh process has no cross-context revocation ledger. The old signed
            // record remains usable within age unless the host supplies current pins.
            await using var fresh = DesktopClient.Create(options, http, directory);
            await fresh.InitializeAsync();
            Assert.True(fresh.IsEnabled("enabled"));
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, true);
        }
    }

    [Theory]
    [InlineData("valid", true)]
    [InlineData("rotation", true)]
    [InlineData("envelope", false)]
    [InlineData("keys", false)]
    [InlineData("context", false)]
    [InlineData("version", false)]
    [InlineData("expired", false)]
    [InlineData("pinned", false)]
    [InlineData("future", false)]
    [InlineData("allowed", false)]
    [InlineData("legacy", false)]
    [InlineData("legacy-pinned", true)]
    public async Task FreshNativeClientReverifiesDurableSnapshotBeforeAttemptingNetwork(string scenario, bool expected)
    {
        using var firstKey = new SignedFixture();
        using var rotatedKey = new SignedFixture();
        var directory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        var keyRequests = 0;
        var acceptedKey = scenario == "rotation" ? rotatedKey : firstKey;
        var options = new TogglyClientOptions
        {
            AppKey = "public",
            Context = new("alice"),
            EnableLiveUpdates = false,
            RefreshInterval = TimeSpan.FromHours(1)
        };

        try
        {
            using (var http = new HttpClient(new Handler((request, _) =>
            {
                var body = request.RequestUri!.AbsolutePath.Contains("jwks")
                    ? (++keyRequests == 1 ? firstKey.Jwks : acceptedKey.Jwks)
                    : acceptedKey.Envelope("{\"enabled\":true}");
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
            })))
            {
                await using var online = DesktopClient.Create(options, http, directory);
                await online.InitializeAsync();
                Assert.True(online.IsEnabled("enabled"));
            }

            var file = Assert.Single(Directory.GetFiles(directory, "*.json"));
            var record = JsonNode.Parse(await File.ReadAllTextAsync(file))!;
            if (scenario == "envelope")
                record["Envelope"] = record["Envelope"]!.GetValue<string>().Replace("true", "false");
            if (scenario == "keys")
                record["TrustedJwks"] = rotatedKey.Jwks;
            if (scenario == "version")
                record["FormatVersion"] = 999;
            if (scenario == "future")
                record["Envelope"] = acceptedKey.Envelope("{\"enabled\":true}", DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds());
            if (scenario is "legacy" or "legacy-pinned")
            {
                record["FormatVersion"] = 1;
                record.AsObject().Remove("TrustedJwks");
            }
            if (scenario == "expired")
                record["Envelope"] = acceptedKey.Envelope("{\"enabled\":true}", DateTimeOffset.UtcNow.AddDays(-31).ToUnixTimeSeconds());
            await File.WriteAllTextAsync(file, record.ToJsonString());

            if (scenario == "allowed")
                options = options with
                {
                    AllowedKeyIds = [rotatedKey.Kid]
                };
            if (scenario == "legacy-pinned")
                options = options with
                {
                    TrustedJwks = firstKey.Jwks
                };
            if (scenario == "context")
                options = options with
                {
                    Context = new("bob")
                };
            if (scenario == "pinned")
                options = options with
                {
                    TrustedJwks = rotatedKey.Jwks
                };
            var requests = 0;
            TogglyClient? fresh = null;
            using var offlineHttp = new HttpClient(new Handler((_, _) =>
            {
                requests++;
                // Restoration must happen before even the first failed HTTP request.
                Assert.Equal(expected, fresh!.IsEnabled("enabled"));
                throw new HttpRequestException("All network access is disabled.");
            }));
            await using (fresh = DesktopClient.Create(options, offlineHttp, directory))
            {
                await fresh.InitializeAsync();
                Assert.Equal(expected, fresh.IsEnabled("enabled"));
                Assert.True(requests > 0);
            }
        }
        finally
        {
            if (Directory.Exists(directory))
                Directory.Delete(directory, true);
        }
    }
}
