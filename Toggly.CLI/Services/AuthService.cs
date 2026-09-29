using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

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
            ["grant_type"] = "client_credentials",
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["scope"] = Constants.DefaultScope
        };

        var requestContent = new FormUrlEncodedContent(tokenRequest);
        var response = await _httpClient.PostAsync(config.TokenEndpoint, requestContent, cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException($"Failed to obtain access token: {response.StatusCode} - {errorContent}");
        }

        var tokenResponse = await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.TokenResponse, cancellationToken);

        if (tokenResponse?.AccessToken == null)
            throw new InvalidOperationException("Failed to obtain access token: response did not contain access_token");

        var expiresAt = DateTime.UtcNow.AddSeconds(tokenResponse.ExpiresIn - 300);
        _tokenCache[cacheKey] = new CachedToken
        {
            Token = tokenResponse.AccessToken,
            ExpiresAt = expiresAt
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

        var request = new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["scope"] = scope
        };

        var response = await _httpClient.PostAsync(
            config.DeviceAuthorizationEndpoint,
            new FormUrlEncodedContent(request),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException($"Device authorization failed: {response.StatusCode} - {errorContent}");
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

            var request = new Dictionary<string, string>
            {
                ["grant_type"] = "urn:ietf:params:oauth:grant-type:device_code",
                ["device_code"] = deviceCode,
                ["client_id"] = clientId
            };

            var response = await _httpClient.PostAsync(
                config.TokenEndpoint,
                new FormUrlEncodedContent(request),
                cancellationToken);

            var body = await response.Content.ReadAsStringAsync(cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                var tokenResponse = System.Text.Json.JsonSerializer.Deserialize(
                    body,
                    TogglyJsonSerializerContext.Default.TokenResponse);

                if (tokenResponse?.AccessToken == null)
                    throw new InvalidOperationException("Device token response did not contain access_token.");

                return new AuthSession
                {
                    AccessToken = tokenResponse.AccessToken,
                    RefreshToken = tokenResponse.RefreshToken,
                    ExpiresAtUtc = DateTime.UtcNow.AddSeconds(tokenResponse.ExpiresIn),
                    Authority = authority.TrimEnd('/'),
                    ClientId = clientId,
                    TokenType = string.IsNullOrEmpty(tokenResponse.TokenType) ? "Bearer" : tokenResponse.TokenType
                };
            }

            var error = TryParseOAuthError(body);
            if (error == "authorization_pending")
            {
                await DelayAsync(interval, cancellationToken);
                continue;
            }

            if (error == "slow_down")
            {
                interval += TimeSpan.FromSeconds(5);
                await DelayAsync(interval, cancellationToken);
                continue;
            }

            if (error == "expired_token" || error == "access_denied")
                throw new InvalidOperationException($"Device authorization ended: {error}.");

            throw new HttpRequestException($"Device token poll failed: {response.StatusCode} - {body}");
        }

        throw new TimeoutException("Device authorization timed out before the user completed login.");
    }

    /// <summary>
    /// Refreshes an access token using a stored refresh token (public client: no secret).
    /// </summary>
    public async Task<AuthSession> RefreshAccessTokenAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(session.RefreshToken))
            throw new InvalidOperationException("Cannot refresh: session has no refresh token. Run 'toggly auth login' again.");

        var authority = string.IsNullOrEmpty(session.Authority) ? Constants.DefaultAuthority : session.Authority;
        var config = await GetOpenIdConfigAsync(authority, cancellationToken);

        var request = new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = session.RefreshToken,
            ["client_id"] = session.ClientId
        };

        var response = await _httpClient.PostAsync(
            config.TokenEndpoint,
            new FormUrlEncodedContent(request),
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
            throw new HttpRequestException($"Failed to refresh access token: {response.StatusCode} - {errorContent}");
        }

        var tokenResponse = await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.TokenResponse, cancellationToken);
        if (tokenResponse?.AccessToken == null)
            throw new InvalidOperationException("Refresh response did not contain access_token.");

        return new AuthSession
        {
            AccessToken = tokenResponse.AccessToken,
            RefreshToken = string.IsNullOrEmpty(tokenResponse.RefreshToken) ? session.RefreshToken : tokenResponse.RefreshToken,
            ExpiresAtUtc = DateTime.UtcNow.AddSeconds(tokenResponse.ExpiresIn),
            Authority = authority.TrimEnd('/'),
            ClientId = session.ClientId,
            TokenType = string.IsNullOrEmpty(tokenResponse.TokenType) ? "Bearer" : tokenResponse.TokenType
        };
    }

    private async Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        var effective = PollDelayOverride ?? delay;
        if (effective > TimeSpan.Zero)
            await Task.Delay(effective, cancellationToken);
    }

    private static string? TryParseOAuthError(string body)
    {
        try
        {
            var error = System.Text.Json.JsonSerializer.Deserialize(body, TogglyJsonSerializerContext.Default.OAuthErrorResponse);
            return error?.Error;
        }
        catch
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

    private class CachedToken
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
