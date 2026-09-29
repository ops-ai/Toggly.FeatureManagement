using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class SecureTokenStoreContractTests
{
    [Fact]
    public async Task SaveThenLoad_ReturnsEquivalentSession()
    {
        ISecureTokenStore store = new InMemorySecureTokenStore();
        var session = CreateSampleSession();

        await store.SaveAsync(session);
        var loaded = await store.LoadAsync();

        Assert.NotNull(loaded);
        Assert.Equal(session.AccessToken, loaded!.AccessToken);
        Assert.Equal(session.RefreshToken, loaded.RefreshToken);
        Assert.Equal(session.ExpiresAtUtc, loaded.ExpiresAtUtc);
        Assert.Equal(session.Authority, loaded.Authority);
        Assert.Equal(session.ClientId, loaded.ClientId);
        Assert.Equal(session.TokenType, loaded.TokenType);
    }

    [Fact]
    public async Task Delete_ClearsStoredSession()
    {
        ISecureTokenStore store = new InMemorySecureTokenStore();
        await store.SaveAsync(CreateSampleSession());

        await store.DeleteAsync();

        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task Save_OverwritesPreviousSession()
    {
        ISecureTokenStore store = new InMemorySecureTokenStore();
        await store.SaveAsync(CreateSampleSession());

        var replacement = CreateSampleSession();
        replacement.AccessToken = "access-2";
        replacement.RefreshToken = "refresh-2";
        await store.SaveAsync(replacement);

        var loaded = await store.LoadAsync();
        Assert.NotNull(loaded);
        Assert.Equal("access-2", loaded!.AccessToken);
        Assert.Equal("refresh-2", loaded.RefreshToken);
    }

    [Fact]
    public void AuthSessionCodec_RoundTripsJson()
    {
        var session = CreateSampleSession();
        var json = AuthSessionCodec.Encode(session);
        var restored = AuthSessionCodec.Decode(json);

        Assert.NotNull(restored);
        Assert.Equal(session.AccessToken, restored!.AccessToken);
        Assert.Equal(session.RefreshToken, restored.RefreshToken);
        Assert.Equal(session.ClientId, restored.ClientId);
    }

    [Fact]
    public void SecureTokenStore_Create_ReturnsStoreOnCurrentOs()
    {
        var store = SecureTokenStore.Create();
        Assert.NotNull(store);
    }

    [Fact]
    public async Task SecureTokenStore_CurrentOs_SaveLoadDeleteRoundTrip()
    {
        if (!OperatingSystem.IsMacOS() && !OperatingSystem.IsWindows() && !OperatingSystem.IsLinux())
            return; // unsupported OS — Create() would throw

        var store = SecureTokenStore.Create();
        var session = CreateSampleSession();
        session.AccessToken = $"access-{Guid.NewGuid():N}";

        await store.SaveAsync(session);
        try
        {
            var loaded = await store.LoadAsync();
            Assert.NotNull(loaded);
            Assert.Equal(session.AccessToken, loaded!.AccessToken);
            Assert.Equal(session.RefreshToken, loaded.RefreshToken);
            Assert.Equal(session.ClientId, loaded.ClientId);
        }
        finally
        {
            await store.DeleteAsync();
        }

        Assert.Null(await store.LoadAsync());
    }

    private static AuthSession CreateSampleSession() => new()
    {
        AccessToken = "access",
        RefreshToken = "refresh",
        ExpiresAtUtc = DateTime.UnixEpoch.AddHours(1),
        Authority = Constants.DefaultAuthority,
        ClientId = Constants.DefaultDeviceClientId,
        TokenType = "Bearer"
    };
}
