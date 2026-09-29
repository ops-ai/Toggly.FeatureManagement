using System.Text;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class WindowsCredentialBlobTests
{
    [Fact]
    public void EncodeUtf8_AuthSession_FitsCredManSoftLimitWithoutUnicodeInflation()
    {
        var session = new AuthSession
        {
            AccessToken = new string('a', 800),
            RefreshToken = new string('r', 800),
            ExpiresAtUtc = DateTime.UnixEpoch.AddHours(1),
            Authority = Constants.DefaultAuthority,
            ClientId = Constants.DefaultDeviceClientId,
            TokenType = "Bearer"
        };

        var utf8 = AuthSessionCodec.EncodeUtf8(session);
        var unicodeInflated = Encoding.Unicode.GetBytes(Encoding.UTF8.GetString(utf8));

        Assert.True(WindowsCredentialBlob.FitsCredManSoftLimit(utf8),
            $"UTF-8 blob was {utf8.Length} bytes; expected ≤ {WindowsCredentialBlob.CredManBlobSoftLimitBytes}.");
        Assert.True(unicodeInflated.Length > utf8.Length);
        Assert.True(unicodeInflated.Length > WindowsCredentialBlob.CredManBlobSoftLimitBytes,
            "Unicode inflation should exceed CredMan soft limit for this fixture — documenting why UTF-8 storage matters.");

        var restored = AuthSessionCodec.DecodeUtf8(utf8);
        Assert.NotNull(restored);
        Assert.Equal(session.AccessToken, restored!.AccessToken);
        Assert.Equal(session.RefreshToken, restored.RefreshToken);
    }

    [Fact]
    public void NormalizeUtf8Payload_TrimsTrailingNulOnly()
    {
        var json = Encoding.UTF8.GetBytes("""{"accessToken":"x"}""");
        var withNul = new byte[json.Length + 1];
        json.CopyTo(withNul, 0);
        withNul[^1] = 0;

        var normalized = WindowsCredentialBlob.NormalizeUtf8Payload(withNul);
        Assert.Equal(json, normalized);

        var unchanged = WindowsCredentialBlob.NormalizeUtf8Payload(json);
        Assert.Equal(json, unchanged);
    }
}
