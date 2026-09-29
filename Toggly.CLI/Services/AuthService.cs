using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Raised when a stored device session can no longer be refreshed and must be cleared.
/// </summary>
public sealed class AuthSessionExpiredException : InvalidOperationException
{
    public AuthSessionExpiredException()
        : base(AuthMessages.SessionExpired)
    {
    }

    public AuthSessionExpiredException(string message)
        : base(message)
    {
    }

    public AuthSessionExpiredException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}

internal static class AuthMessages
{
    public const string SessionExpired =
        "Session expired or was revoked. Run 'toggly auth login' to sign in again.";

    public const string MissingRefreshToken =
        "Session has no refresh token. Run 'toggly auth login' again.";

    public const string OfflineAccessRequired =
        "Login did not return a refresh token. Ensure the IdP client allows offline_access " +
        "(AllowOfflineAccess) and includes the offline_access scope, then run 'toggly auth login' again.";
}

internal static class OAuthFormKeys
{
    public const string ClientId = "client_id";
    public const string ClientSecret = "client_secret";
    public const string GrantType = "grant_type";
    public const string Scope = "scope";
    public const string RefreshToken = "refresh_token";
    public const string DeviceCode = "device_code";
}

/// <summary>
/// OAuth2 authentication: client credentials, device code, and refresh.
/// </summary>
public class AuthService
{
    private readonly HttpClient _httpClient;
    private readonly ConcurrentDictionary<string, CachedToken> _tokenCache = new();
    private readonly ConcurrentDictionary<string, OpenIdConfig> _configCache = new();

    /// <summary>
    /// When set (tests only), replaces the poll sleep between device-code token attempts.
    /// </summary>
    internal TimeSpan? PollDelayOverride { get; set; }

    public AuthService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    /// <summary>
    /// Get access token using client credentials flow.
    /// </summary>
    public async Task<string> GetAccessTokenAsync(string clientId, string clientSecret, string authority, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"{authority}:{clientId}";

        if (_tokenCache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAt > DateTime.UtcNow.AddMinutes(5))
            return cached.Token;

        var config = await GetOpenIdConfigAsync(authority, cancellationToken);

        var tokenRequest = new Dictionary<string, string>
        {
            [OAuthFormKeys.GrantType] = "client_credentials",
            [OAuthFormKeys.ClientId] = clientId,
            [OAuthFormKeys.ClientSecret] = clientSecret,
            [OAuthFormKeys.Scope] = Constants.DefaultScope
        };

        var response = await _httpClient.PostAsync(
            config.TokenEndpoint,
            new FormUrlEncodedContent(tokenRequest),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(FormatOAuthFailure("Client credentials token request", response.StatusCode, errorContent));
        }

        var tokenResponse = await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.TokenResponse, cancellationToken);
        if (tokenResponse?.AccessToken == null)
            throw new InvalidOperationException("Failed to obtain access token: response did not contain access_token");

        _tokenCache[cacheKey] = new CachedToken
        {
            Token = tokenResponse.AccessToken,
            ExpiresAt = DateTime.UtcNow.AddSeconds(tokenResponse.ExpiresIn - 300)
        };

        return tokenResponse.AccessToken;
    }

    /// <summary>
    /// Starts the OAuth2 device authorization flow.
    /// </summary>
    public async Task<DeviceAuthorizationResponse> StartDeviceAuthorizationAsync(
        string clientId,
        string authority,
        string scope,
        CancellationToken cancellationToken = default)
    {
        var config = await GetOpenIdConfigAsync(authority, cancellationToken);
        if (string.IsNullOrEmpty(config.DeviceAuthorizationEndpoint))
        {
            throw new InvalidOperationException(
                "OpenID configuration did not contain device_authorization_endpoint. " +
                "Device-code login is not available for this authority.");
        }

        var response = await _httpClient.PostAsync(
            config.DeviceAuthorizationEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                [OAuthFormKeys.ClientId] = clientId,
                [OAuthFormKeys.Scope] = scope
            }),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(FormatOAuthFailure("Device authorization", response.StatusCode, errorContent));
        }

        var deviceResponse = await response.Content.ReadFromJsonAsync(
            TogglyJsonSerializerContext.Default.DeviceAuthorizationResponse,
            cancellationToken);

        if (deviceResponse?.DeviceCode == null || deviceResponse.UserCode == null || deviceResponse.VerificationUri == null)
            throw new InvalidOperationException("Device authorization response was incomplete.");

        if (deviceResponse.Interval <= 0)
            deviceResponse.Interval = 5;

        return deviceResponse;
    }

    /// <summary>
    /// Polls the token endpoint until the user completes device consent or the code expires.
    /// </summary>
    public async Task<AuthSession> WaitForDeviceTokenAsync(
        string clientId,
        string authority,
        string deviceCode,
        int intervalSeconds,
        int expiresInSeconds,
        CancellationToken cancellationToken = default)
    {
        var config = await GetOpenIdConfigAsync(authority, cancellationToken);
        var deadline = DateTime.UtcNow.AddSeconds(Math.Max(expiresInSeconds, 1));
        var interval = TimeSpan.FromSeconds(Math.Max(intervalSeconds, 1));

        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var (statusCode, body) = await PostDeviceTokenPollAsync(
                config.TokenEndpoint,
                clientId,
                deviceCode,
                cancellationToken);

            if (IsSuccessStatusCode(statusCode))
                return ParseSuccessfulDeviceToken(body, clientId, authority);

            interval = await HandleDevicePollErrorAsync(statusCode, body, interval, cancellationToken);
        }

        throw new TimeoutException("Device authorization timed out before the user completed login.");
    }

    /// <summary>
    /// Refreshes an access token using a stored refresh token (public client: no secret).
    /// </summary>
    /// <exception cref="AuthSessionExpiredException">When the refresh token is invalid or revoked.</exception>
    public async Task<AuthSession> RefreshAccessTokenAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(session.RefreshToken))
            throw new AuthSessionExpiredException(AuthMessages.MissingRefreshToken);

        var authority = string.IsNullOrEmpty(session.Authority) ? Constants.DefaultAuthority : session.Authority;
        var config = await GetOpenIdConfigAsync(authority, cancellationToken);

        var response = await _httpClient.PostAsync(
            config.TokenEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                [OAuthFormKeys.GrantType] = "refresh_token",
                [OAuthFormKeys.RefreshToken] = session.RefreshToken,
                [OAuthFormKeys.ClientId] = session.ClientId
            }),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            var oauthError = TryParseOAuthErrorResponse(errorContent)?.Error;
            if (IsPermanentRefreshFailure(oauthError))
                throw new AuthSessionExpiredException(AuthMessages.SessionExpired);

            throw new InvalidOperationException(FormatOAuthFailure("Token refresh", response.StatusCode, errorContent));
        }

        var tokenResponse = await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.TokenResponse, cancellationToken);
        if (tokenResponse?.AccessToken == null)
            throw new InvalidOperationException("Refresh response did not contain access_token.");

        return CreateSessionFromTokenResponse(tokenResponse, session.ClientId, authority, session.RefreshToken);
    }

    private async Task<(HttpStatusCode StatusCode, string Body)> PostDeviceTokenPollAsync(
        string tokenEndpoint,
        string clientId,
        string deviceCode,
        CancellationToken cancellationToken)
    {
        var response = await _httpClient.PostAsync(
            tokenEndpoint,
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                [OAuthFormKeys.GrantType] = "urn:ietf:params:oauth:grant-type:device_code",
                [OAuthFormKeys.DeviceCode] = deviceCode,
                [OAuthFormKeys.ClientId] = clientId
            }),
            cancellationToken);

        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        return (response.StatusCode, body);
    }

    private static AuthSession ParseSuccessfulDeviceToken(string body, string clientId, string authority)
    {
        TokenResponse? tokenResponse;
        try
        {
            tokenResponse = System.Text.Json.JsonSerializer.Deserialize(
                body,
                TogglyJsonSerializerContext.Default.TokenResponse);
        }
        catch (System.Text.Json.JsonException)
        {
            throw new InvalidOperationException("Device token response was incomplete or invalid.");
        }

        if (tokenResponse?.AccessToken == null)
            throw new InvalidOperationException("Device token response did not contain access_token.");

        if (string.IsNullOrEmpty(tokenResponse.RefreshToken))
            throw new InvalidOperationException(AuthMessages.OfflineAccessRequired);

        return CreateSessionFromTokenResponse(tokenResponse, clientId, authority, fallbackRefreshToken: null);
    }

    private async Task<TimeSpan> HandleDevicePollErrorAsync(
        HttpStatusCode statusCode,
        string body,
        TimeSpan interval,
        CancellationToken cancellationToken)
    {
        var error = TryParseOAuthErrorResponse(body)?.Error;
        if (error == "authorization_pending")
        {
            await DelayAsync(interval, cancellationToken);
            return interval;
        }

        if (error == "slow_down")
        {
            var slowed = interval + TimeSpan.FromSeconds(5);
            await DelayAsync(slowed, cancellationToken);
            return slowed;
        }

        if (error is "expired_token" or "access_denied")
            throw new InvalidOperationException(FormatOAuthFailure("Device authorization", statusCode, body));

        throw new InvalidOperationException(FormatOAuthFailure("Device token poll", statusCode, body));
    }

    private static AuthSession CreateSessionFromTokenResponse(
        TokenResponse tokenResponse,
        string clientId,
        string authority,
        string? fallbackRefreshToken)
    {
        return new AuthSession
        {
            AccessToken = tokenResponse.AccessToken,
            RefreshToken = string.IsNullOrEmpty(tokenResponse.RefreshToken)
                ? fallbackRefreshToken
                : tokenResponse.RefreshToken,
            ExpiresAtUtc = DateTime.UtcNow.AddSeconds(tokenResponse.ExpiresIn),
            Authority = authority.TrimEnd('/'),
            ClientId = clientId,
            TokenType = string.IsNullOrEmpty(tokenResponse.TokenType) ? "Bearer" : tokenResponse.TokenType
        };
    }

    private static bool IsSuccessStatusCode(HttpStatusCode statusCode)
        => (int)statusCode >= 200 && (int)statusCode <= 299;

    private async Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        var effective = PollDelayOverride ?? delay;
        if (effective > TimeSpan.Zero)
            await Task.Delay(effective, cancellationToken);
    }

    private static bool IsPermanentRefreshFailure(string? error) =>
        error is "invalid_grant" or "invalid_token" or "expired_token" or "access_denied";

    /// <summary>
    /// Builds a short user-facing OAuth error without dumping raw response bodies or tokens.
    /// </summary>
    internal static string FormatOAuthFailure(string operation, HttpStatusCode statusCode, string body)
    {
        var parsed = TryParseOAuthErrorResponse(body);
        if (!string.IsNullOrEmpty(parsed?.Error))
        {
            var description = SanitizeErrorDescription(parsed.ErrorDescription);
            if (!string.IsNullOrEmpty(description))
                return $"{operation} failed ({parsed.Error}): {description}";

            return $"{operation} failed ({parsed.Error}).";
        }

        return $"{operation} failed (HTTP {(int)statusCode}).";
    }

    private static string? SanitizeErrorDescription(string? description)
    {
        if (string.IsNullOrWhiteSpace(description))
            return null;

        var trimmed = description.Trim();
        if (trimmed.Contains("eyJ", StringComparison.Ordinal) ||
            trimmed.Contains("Bearer ", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Length > 200)
        {
            return null;
        }

        return trimmed;
    }

    private static OAuthErrorResponse? TryParseOAuthErrorResponse(string body)
    {
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize(body, TogglyJsonSerializerContext.Default.OAuthErrorResponse);
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    private async Task<OpenIdConfig> GetOpenIdConfigAsync(string authority, CancellationToken cancellationToken)
    {
        if (_configCache.TryGetValue(authority, out var cached))
            return cached;

        var discoveryUrl = authority.TrimEnd('/') + "/.well-known/openid-configuration";
        var response = await _httpClient.GetAsync(discoveryUrl, cancellationToken);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Failed to fetch OpenID configuration: {response.StatusCode}");

        var config = await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.OpenIdConfig, cancellationToken);
        if (config?.TokenEndpoint == null)
            throw new InvalidOperationException("OpenID configuration did not contain token_endpoint");

        _configCache[authority] = config;
        return config;
    }

    private sealed class CachedToken
    {
        public string Token { get; set; } = string.Empty;
        public DateTime ExpiresAt { get; set; }
    }

    public class OpenIdConfig
    {
        [JsonPropertyName("token_endpoint")]
        public required string TokenEndpoint { get; set; }

        [JsonPropertyName("device_authorization_endpoint")]
        public string? DeviceAuthorizationEndpoint { get; set; }
    }

    public class TokenResponse
    {
        [JsonPropertyName("access_token")]
        public required string AccessToken { get; set; }

        [JsonPropertyName("refresh_token")]
        public string? RefreshToken { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }

        [JsonPropertyName("token_type")]
        public string TokenType { get; set; } = "Bearer";
    }

    public class DeviceAuthorizationResponse
    {
        [JsonPropertyName("device_code")]
        public required string DeviceCode { get; set; }

        [JsonPropertyName("user_code")]
        public required string UserCode { get; set; }

        [JsonPropertyName("verification_uri")]
        public required string VerificationUri { get; set; }

        [JsonPropertyName("verification_uri_complete")]
        public string? VerificationUriComplete { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }

        [JsonPropertyName("interval")]
        public int Interval { get; set; } = 5;
    }

    public class OAuthErrorResponse
    {
        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("error_description")]
        public string? ErrorDescription { get; set; }
    }
}
