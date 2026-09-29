using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Models;
using Xunit;

namespace Toggly.CLI.Tests;

public class AuthSessionTests
{
    [Fact]
    public void AuthSession_RoundTripsThroughSourceGeneratedContext()
    {
        var session = new AuthSession
        {
            AccessToken = "access",
            RefreshToken = "refresh",
            ExpiresAtUtc = DateTime.UnixEpoch.AddHours(1),
            Authority = "https://auth.toggly.io",
            ClientId = Constants.DefaultDeviceClientId,
            TokenType = "Bearer"
        };

        var json = JsonSerializer.Serialize(session, TogglyJsonSerializerContext.Default.AuthSession);
        var restored = JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.AuthSession);

        Assert.NotNull(restored);
        Assert.Equal(session.AccessToken, restored!.AccessToken);
        Assert.Equal(session.RefreshToken, restored.RefreshToken);
        Assert.Equal(session.ClientId, restored.ClientId);
        Assert.Equal(session.Authority, restored.Authority);
        Assert.Equal(session.ExpiresAtUtc, restored.ExpiresAtUtc);
        Assert.Equal(session.TokenType, restored.TokenType);
    }
}
