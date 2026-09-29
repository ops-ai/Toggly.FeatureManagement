namespace Toggly.CLI.Models;

/// <summary>
/// Device-code / refresh session persisted only in the OS credential store.
/// Does not include a client secret (public native client).
/// </summary>
public sealed class AuthSession
{
    public string AccessToken { get; set; } = string.Empty;

    public string? RefreshToken { get; set; }

    public DateTime ExpiresAtUtc { get; set; }

    public string Authority { get; set; } = Constants.DefaultAuthority;

    public string ClientId { get; set; } = Constants.DefaultDeviceClientId;

    public string TokenType { get; set; } = "Bearer";
}
