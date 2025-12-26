using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Toggly.CLI;

namespace Toggly.CLI.Services;

/// <summary>
/// Service for OAuth2 client credentials authentication
/// </summary>
public class AuthService
{
    private readonly HttpClient _httpClient;
    private readonly ConcurrentDictionary<string, CachedToken> _tokenCache = new();
    private readonly ConcurrentDictionary<string, OpenIdConfig> _configCache = new();

    public AuthService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    /// <summary>
    /// Get access token using client credentials flow
    /// </summary>
    public async Task<string> GetAccessTokenAsync(string clientId, string clientSecret, string authority, CancellationToken cancellationToken = default)
    {
        var cacheKey = $"{authority}:{clientId}";
        
        // Check cache
        if (_tokenCache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAt > DateTime.UtcNow.AddMinutes(5))
        {
            return cached.Token;
        }

        // Get OpenID configuration
        var config = await GetOpenIdConfigAsync(authority, cancellationToken);

        // Request token
        var tokenRequest = new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["scope"] = "openid toggly"
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

        // Cache token
        var expiresAt = DateTime.UtcNow.AddSeconds(tokenResponse.ExpiresIn - 300); // Refresh 5 minutes before expiry
        _tokenCache[cacheKey] = new CachedToken
        {
            Token = tokenResponse.AccessToken,
            ExpiresAt = expiresAt
        };

        return tokenResponse.AccessToken;
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
    }

    public class TokenResponse
    {
        [JsonPropertyName("access_token")]
        public required string AccessToken { get; set; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; set; }

        [JsonPropertyName("token_type")]
        public string TokenType { get; set; } = "Bearer";
    }
}

