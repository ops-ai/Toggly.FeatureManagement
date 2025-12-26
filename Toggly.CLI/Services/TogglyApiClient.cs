using System.Net.Http.Json;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI;

namespace Toggly.CLI.Services;

/// <summary>
/// HTTP client wrapper for Toggly API
/// </summary>
public class TogglyApiClient
{
    private readonly HttpClient _httpClient;
    private readonly AuthService _authService;
    private readonly string _baseUrl;
    private readonly string? _clientId;
    private readonly string? _clientSecret;
    private readonly string? _authority;

    public TogglyApiClient(
        HttpClient httpClient,
        AuthService authService,
        string baseUrl,
        string? clientId = null,
        string? clientSecret = null,
        string? authority = null)
    {
        _httpClient = httpClient;
        _authService = authService;
        _baseUrl = baseUrl.TrimEnd('/');
        _clientId = clientId;
        _clientSecret = clientSecret;
        _authority = authority;
    }

    /// <summary>
    /// Ensure authentication header is set
    /// </summary>
    private async Task EnsureAuthAsync(CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrEmpty(_clientId) && !string.IsNullOrEmpty(_clientSecret) && !string.IsNullOrEmpty(_authority))
        {
            var token = await _authService.GetAccessTokenAsync(_clientId, _clientSecret, _authority, cancellationToken);
            _httpClient.DefaultRequestHeaders.Authorization = 
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        }
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

