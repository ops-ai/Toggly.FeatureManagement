using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class CredentialResolverTests
{
    [Fact]
    public async Task ResolveAsync_PrefersExplicitClientCredentialsOverStore()
    {
        var store = new InMemorySecureTokenStore();
        await store.SaveAsync(new AuthSession
        {
            AccessToken = "session-token",
            RefreshToken = "refresh",
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1),
            ClientId = "stored-client",
            Authority = Constants.DefaultAuthority
        });

        var resolved = await CredentialResolver.ResolveAsync(
            clientId: "cli-id",
            clientSecret: "cli-secret",
            authority: "https://auth.example.test",
            tokenStore: store);

        Assert.Equal(ResolvedAuthKind.ClientCredentials, resolved.Kind);
        Assert.Equal("cli-id", resolved.ClientId);
        Assert.Equal("cli-secret", resolved.ClientSecret);
        Assert.Equal("https://auth.example.test", resolved.Authority);
        Assert.Null(resolved.Session);
    }

    [Fact]
    public async Task ResolveAsync_UsesStoredSessionWhenNoSecret()
    {
        var store = new InMemorySecureTokenStore();
        var session = new AuthSession
        {
            AccessToken = "session-token",
            RefreshToken = "refresh",
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1),
            ClientId = "toggly-cli",
            Authority = "https://auth.example.test"
        };
        await store.SaveAsync(session);

        var resolved = await CredentialResolver.ResolveAsync(
            clientId: null,
            clientSecret: null,
            authority: null,
            tokenStore: store);

        Assert.Equal(ResolvedAuthKind.DeviceSession, resolved.Kind);
        Assert.NotNull(resolved.Session);
        Assert.Equal("session-token", resolved.Session!.AccessToken);
        Assert.Equal("https://auth.example.test", resolved.Authority);
    }

    [Fact]
    public async Task ResolveAsync_ThrowsWithGuidanceWhenUnauthenticated()
    {
        var store = new InMemorySecureTokenStore();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CredentialResolver.ResolveAsync(null, null, null, store));

        Assert.Contains("toggly auth login", ex.Message);
        Assert.Contains("TOGGLY_CLIENT_ID", ex.Message);
        Assert.Contains("TOGGLY_CLIENT_SECRET", ex.Message);
    }

    [Fact]
    public async Task ResolveAsync_ThrowsWhenSecretWithoutClientId()
    {
        var store = new InMemorySecureTokenStore();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CredentialResolver.ResolveAsync(null, "secret-only", null, store));

        Assert.Contains("client-id", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ResolveAsync_ThrowsWhenClientIdWithoutSecretAndNoSession()
    {
        var store = new InMemorySecureTokenStore();

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CredentialResolver.ResolveAsync("id-only", null, null, store));

        Assert.Contains("toggly auth login", ex.Message);
    }
}
