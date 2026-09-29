namespace Toggly.CLI;

/// <summary>
/// Shared defaults for CLI auth and credential storage.
/// </summary>
public static class Constants
{
    public const string DefaultAuthority = "https://auth.toggly.io";
    public const string DefaultBaseUrl = "https://app.toggly.io/api";
    public const string DefaultDeviceClientId = "toggly-cli";
    public const string DefaultScope = "openid toggly";
    /// <summary>
    /// Device-code login scopes. Includes offline_access so the IdP issues a refresh token
    /// when AllowOfflineAccess is enabled on the public client.
    /// </summary>
    public const string DefaultDeviceScope = "openid toggly offline_access";
    public const string CredentialServiceName = "toggly-cli";
    public const string CredentialAccountName = "auth-session";
}
