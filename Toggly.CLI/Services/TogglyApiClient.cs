using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization.Metadata;
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
            await EnsureClientCredentialsAuthAsync(cancellationToken);
            return;
        }

        await EnsureDeviceSessionAuthAsync(cancellationToken);
    }

    private async Task EnsureClientCredentialsAuthAsync(CancellationToken cancellationToken)
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
    }

    private async Task EnsureDeviceSessionAuthAsync(CancellationToken cancellationToken)
    {
        var session = _session ?? _credentials.Session
            ?? throw new InvalidOperationException("No device session available. Run 'toggly auth login'.");

        if (session.ExpiresAtUtc <= DateTime.UtcNow.AddMinutes(5))
            session = await RefreshDeviceSessionAsync(session, cancellationToken);

        var scheme = string.IsNullOrEmpty(session.TokenType) ? "Bearer" : session.TokenType;
        _httpClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue(scheme, session.AccessToken);
    }

    private async Task<AuthSession> RefreshDeviceSessionAsync(AuthSession session, CancellationToken cancellationToken)
    {
        try
        {
            session = await _authService.RefreshAccessTokenAsync(session, cancellationToken);
            _session = session;
            if (_tokenStore is not null)
                await _tokenStore.SaveAsync(session, cancellationToken);
            return session;
        }
        catch (AuthSessionExpiredException)
        {
            await ClearExpiredDeviceSessionAsync(cancellationToken);
            throw;
        }
    }

    private async Task ClearExpiredDeviceSessionAsync(CancellationToken cancellationToken)
    {
        _session = null;
        if (_tokenStore is null)
            return;

        try
        {
            await _tokenStore.DeleteAsync(cancellationToken);
        }
        catch (Exception)
        {
            // Best effort — still surface the expired-session guidance.
        }
    }

    /// <summary>
    /// List applications.
    /// </summary>
    public Task<List<ApplicationSummary>> ListApplicationsAsync(CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            "/applications",
            TogglyJsonSerializerContext.Default.ListApplicationSummary,
            "Applications",
            cancellationToken);

    /// <summary>
    /// Get an application by id.
    /// </summary>
    public Task<ApplicationSummary> GetApplicationAsync(string applicationId, CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            $"/applications/{Uri.EscapeDataString(applicationId)}",
            TogglyJsonSerializerContext.Default.ApplicationSummary,
            $"Application '{applicationId}'",
            cancellationToken);

    /// <summary>
    /// List environments for an application.
    /// </summary>
    public Task<List<EnvironmentSummary>> ListEnvironmentsAsync(string applicationId, CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            $"/applications/{Uri.EscapeDataString(applicationId)}/environments",
            TogglyJsonSerializerContext.Default.ListEnvironmentSummary,
            $"Environments for application '{applicationId}'",
            cancellationToken);

    /// <summary>
    /// Get an environment by name.
    /// </summary>
    public Task<EnvironmentSummary> GetEnvironmentAsync(
        string applicationId,
        string environmentName,
        CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            $"/applications/{Uri.EscapeDataString(applicationId)}/environments/{Uri.EscapeDataString(environmentName)}",
            TogglyJsonSerializerContext.Default.EnvironmentSummary,
            $"Environment '{environmentName}'",
            cancellationToken);

    /// <summary>
    /// List features for an application.
    /// </summary>
    public Task<List<FeatureDefinition>> ListFeaturesAsync(string applicationId, CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            $"/applications/{Uri.EscapeDataString(applicationId)}/features",
            TogglyJsonSerializerContext.Default.ListFeatureDefinition,
            $"Features for application '{applicationId}'",
            cancellationToken);

    /// <summary>
    /// Get a feature by key.
    /// </summary>
    public Task<FeatureDefinition> GetFeatureAsync(
        string applicationId,
        string featureKey,
        CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            $"/applications/{Uri.EscapeDataString(applicationId)}/features/{Uri.EscapeDataString(featureKey)}",
            TogglyJsonSerializerContext.Default.FeatureDefinition,
            $"Feature '{featureKey}'",
            cancellationToken);

    /// <summary>
    /// List releases with optional filters.
    /// </summary>
    public Task<List<ReleaseSummary>> ListReleasesAsync(
        string? applicationId = null,
        string? environment = null,
        string? status = null,
        string? search = null,
        CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            BuildReleasesListPath(applicationId, environment, status, search),
            TogglyJsonSerializerContext.Default.ListReleaseSummary,
            "Releases",
            cancellationToken);

    /// <summary>
    /// Get a release by id.
    /// </summary>
    public Task<ReleaseModel> GetReleaseAsync(string releaseId, CancellationToken cancellationToken = default) =>
        GetJsonAsync(
            $"/releases/{Uri.EscapeDataString(releaseId)}",
            TogglyJsonSerializerContext.Default.ReleaseModel,
            $"Release '{releaseId}'",
            cancellationToken);

    /// <summary>
    /// Create a new release
    /// </summary>
    public async Task<ReleaseModel> CreateReleaseAsync(CreateReleaseRequest request, CancellationToken cancellationToken = default)
    {
        await EnsureAuthAsync(cancellationToken);
        var response = await _httpClient.PostAsJsonAsync($"{_baseUrl}/releases", request, TogglyJsonSerializerContext.Default.CreateReleaseRequest, cancellationToken);
        await EnsureSuccessOrThrowAsync(response, "Release");
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
        await EnsureSuccessOrThrowAsync(response, "Associate build");
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
        await EnsureSuccessOrThrowAsync(response, "Feature");
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
        await EnsureSuccessOrThrowAsync(response, $"Feature '{featureKey}'");
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
        await EnsureSuccessOrThrowAsync(response, $"Feature '{featureKey}' in environment '{environment}'");
        return await response.Content.ReadFromJsonAsync(TogglyJsonSerializerContext.Default.ListFeatureFilter, cancellationToken)
            ?? throw new InvalidOperationException("Failed to deserialize feature filters response");
    }

    private async Task<T> GetJsonAsync<T>(
        string relativePath,
        JsonTypeInfo<T> typeInfo,
        string resource,
        CancellationToken cancellationToken)
    {
        await EnsureAuthAsync(cancellationToken);
        using var response = await _httpClient.GetAsync($"{_baseUrl}{relativePath}", cancellationToken);
        await EnsureSuccessOrThrowAsync(response, resource);
        return await response.Content.ReadFromJsonAsync(typeInfo, cancellationToken)
            ?? throw new InvalidOperationException($"Failed to deserialize {resource.ToLowerInvariant()} response");
    }

    private static string BuildReleasesListPath(
        string? applicationId,
        string? environment,
        string? status,
        string? search)
    {
        var query = new StringBuilder();
        void Append(string name, string? value)
        {
            if (string.IsNullOrEmpty(value))
                return;
            query.Append(query.Length == 0 ? '?' : '&');
            query.Append(Uri.EscapeDataString(name));
            query.Append('=');
            query.Append(Uri.EscapeDataString(value));
        }

        Append("applicationId", applicationId);
        Append("environment", environment);
        Append("status", status);
        Append("search", search);
        return $"/releases{query}";
    }

    private static async Task EnsureSuccessOrThrowAsync(HttpResponseMessage response, string resource)
    {
        if (response.IsSuccessStatusCode)
            return;

        if (response.StatusCode == HttpStatusCode.NotFound)
            throw new InvalidOperationException($"{resource} not found.");

        var body = response.Content is null
            ? string.Empty
            : await response.Content.ReadAsStringAsync();
        var detail = string.IsNullOrWhiteSpace(body) ? response.ReasonPhrase : body.Trim();
        throw new InvalidOperationException(
            $"API error ({(int)response.StatusCode}): {detail}");
    }
}
