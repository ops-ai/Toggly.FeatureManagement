using System.Net.Http.Json;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// HTTP client wrapper for Toggly API.
/// </summary>
public class TogglyApiClient
{
    private readonly HttpClient _httpClient;
    private readonly AuthService _authService;
    private readonly string _baseUrl;
    private readonly ResolvedCredentials _credentials;
    private readonly ISecureTokenStore? _tokenStore;
    private AuthSession? _session;

    public TogglyApiClient(
        HttpClient httpClient,
        AuthService authService,
        string baseUrl,
        string? clientId = null,
        string? clientSecret = null,
        string? authority = null)
        : this(
            httpClient,
            authService,
            baseUrl,
            new ResolvedCredentials
            {
                Kind = ResolvedAuthKind.ClientCredentials,
                ClientId = clientId,
                ClientSecret = clientSecret,
                Authority = authority ?? Constants.DefaultAuthority
            },
            tokenStore: null)
    {
    }

    public TogglyApiClient(
        HttpClient httpClient,
        AuthService authService,
        string baseUrl,
        ResolvedCredentials credentials,
        ISecureTokenStore? tokenStore = null)
    {
        _httpClient = httpClient;
        _authService = authService;
        _baseUrl = baseUrl.TrimEnd('/');
        _credentials = credentials;
        _tokenStore = tokenStore;
        _session = credentials.Session;
    }

    /// <summary>
    /// Ensure authentication header is set.
    /// </summary>
    private async Task EnsureAuthAsync(CancellationToken cancellationToken = default)
    {
        if (_credentials.Kind == ResolvedAuthKind.ClientCredentials)
        {
            // Match prior behavior: skip bearer when credentials were not supplied
            // (tests inject unauthenticated clients via the factory).
            if (string.IsNullOrEmpty(_credentials.ClientId) ||
                string.IsNullOrEmpty(_credentials.ClientSecret) ||
                string.IsNullOrEmpty(_credentials.Authority))
            {
                return;
            }

            var token = await _authService.GetAccessTokenAsync(
                _credentials.ClientId,
                _credentials.ClientSecret,
                _credentials.Authority,
                cancellationToken);
            _httpClient.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            return;
        }

        var session = _session ?? _credentials.Session
            ?? throw new InvalidOperationException("No device session available. Run 'toggly auth login'.");

        // Refresh when expired or within 5 minutes of expiry.
        if (session.ExpiresAtUtc <= DateTime.UtcNow.AddMinutes(5))
        {
            try
            {
                session = await _authService.RefreshAccessTokenAsync(session, cancellationToken);
                _session = session;
                if (_tokenStore is not null)
                    await _tokenStore.SaveAsync(session, cancellationToken);
            }
            catch (AuthSessionExpiredException)
            {
                _session = null;
                if (_tokenStore is not null)
                {
                    try
                    {
                        await _tokenStore.DeleteAsync(cancellationToken);
                    }
                    catch
                    {
                        // Best effort — still surface the expired-session guidance.
                    }
                }

                throw;
            }
        }

        _httpClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue(
                string.IsNullOrEmpty(session.TokenType) ? "Bearer" : session.TokenType,
                session.AccessToken);
    }

    /// <summary>
    /// Create a new release
    /// </summary>
    public async Task<ReleaseModel> CreateReleaseAsync(CreateReleaseRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureAuthAsync(cancellationToken);
        var response = await _httpClient.PostAsJsonAsync($"{_baseUrl}/releases", request, TogglyJsonSerializerContext.Default.CreateReleaseRequest, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.ReleaseModel, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize release response");
    }

    /// <summary>
    /// Associate a CI build with a release
    /// </summary>
    public async Task<AssociateBuildResponse> AssociateBuildAsync(AssociateBuildRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureAuthAsync(cancellationToken);
        var response = await _httpClient.PostAsJsonAsync($"{_baseUrl}/releases/associate-build", request, TogglyJsonSerializerContext.Default.AssociateBuildRequest, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.AssociateBuildResponse, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize associate build response");
    }

    /// <summary>
    /// Create a new feature
    /// </summary>
    public async Task<FeatureDefinition> CreateFeatureAsync(string applicationId, FeatureDefinitionCreateModel model, CancellationToken cancellationToken = default)
    {
        await EnsureAuthAsync(cancellationToken);
        var response = await _httpClient.PostAsJsonAsync($"{_baseUrl}/applications/{applicationId}/features", model, TogglyJsonSerializerContext.Default.FeatureDefinitionCreateModel, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.FeatureDefinition, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize feature response");
    }

    /// <summary>
    /// Update an existing feature
    /// </summary>
    public async Task<FeatureDefinition> UpdateFeatureAsync(string applicationId, string featureKey, FeatureDefinition model, CancellationToken cancellationToken = default)
    {
        await EnsureAuthAsync(cancellationToken);
        var response = await _httpClient.PutAsJsonAsync($"{_baseUrl}/applications/{applicationId}/features/{featureKey}", model, TogglyJsonSerializerContext.Default.FeatureDefinition, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.FeatureDefinition, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize feature response");
    }

    /// <summary>
    /// Update feature configuration on a specific environment
    /// </summary>
    public async Task<List<FeatureFilter>> UpdateFeatureEnvironmentAsync(
        string applicationId,
        string environment,
        string featureKey,
        List<FeatureFilter> filters,
        CancellationToken cancellationToken = default)
    {
        await EnsureAuthAsync(cancellationToken);
        var response = await _httpClient.PutAsJsonAsync(
            $"{_baseUrl}/applications/{applicationId}/environments/{environment}/features/{featureKey}",
            filters,
            TogglyJsonSerializerContext.Default.ListFeatureFilter,
            cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.ListFeatureFilter, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize feature filters response");
    }
}
