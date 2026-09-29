using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class SecureTokenStoreContractTests
{
    [Fact]
    public async Task SaveThenLoad_ReturnsEquivalentSession()
    {
        InMemorySecureTokenStore store = new();
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
        InMemorySecureTokenStore store = new();
        await store.SaveAsync(CreateSampleSession());

        await store.DeleteAsync();

        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task Save_OverwritesPreviousSession()
    {
        InMemorySecureTokenStore store = new();
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

        ISecureTokenStore store;
        try
        {
            store = SecureTokenStore.Create();
        }
        catch (Exception ex) when (ex is PlatformNotSupportedException or DllNotFoundException)
        {
            // Skip when the platform has no store implementation.
            return;
        }

        var session = CreateSampleSession();
        session.AccessToken = $"access-{Guid.NewGuid():N}";

        try
        {
            await store.SaveAsync(session);
        }
        catch (Exception ex) when (ex is InvalidOperationException or DllNotFoundException)
        {
            // Skip when the OS store is unavailable (e.g. Linux CI without libsecret/keyring).
            // In-memory contract tests above remain mandatory.
            return;
        }

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
            try
            {
                await store.DeleteAsync();
            }
            catch (Exception ex) when (ex is InvalidOperationException or DllNotFoundException)
            {
                // Best effort cleanup when the store becomes unavailable mid-test.
            }
        }

        try
        {
            Assert.Null(await store.LoadAsync());
        }
        catch (Exception ex) when (ex is InvalidOperationException or DllNotFoundException)
        {
            // Already exercised save/load when the store was available.
        }
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
