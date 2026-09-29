using System.Net;
using System.Text;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class TogglyApiClientAuthTests
{
    [Fact]
    public async Task CreateFeatureAsync_WithDeviceSession_SetsBearerWithoutClientCredentials()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/applications/app-1/features" => JsonResponse("{\"name\":\"Payments\",\"featureKey\":\"payments-enabled\"}"),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var store = new InMemorySecureTokenStore();
        var session = new AuthSession
        {
            AccessToken = "device-token",
            RefreshToken = "refresh-token",
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1),
            Authority = "https://auth.example.test",
            ClientId = Constants.DefaultDeviceClientId,
            TokenType = "Bearer"
        };
        await store.SaveAsync(session);

        var credentials = new ResolvedCredentials
        {
            Kind = ResolvedAuthKind.DeviceSession,
            ClientId = session.ClientId,
            Authority = session.Authority,
            Session = session
        };

        var apiClient = new TogglyApiClient(
            httpClient,
            new AuthService(httpClient),
            "https://api.example.test/",
            credentials,
            store);

        var feature = await apiClient.CreateFeatureAsync("app-1", new()
        {
            Name = "Payments",
            FeatureKey = "payments-enabled"
        });

        Assert.Equal("payments-enabled", feature.FeatureKey);
        Assert.Single(handler.Requests);
        Assert.Equal("Bearer", handler.Requests[0].Headers.Authorization!.Scheme);
        Assert.Equal("device-token", handler.Requests[0].Headers.Authorization!.Parameter);
        Assert.DoesNotContain(handler.Requests, r => r.RequestUri!.AbsolutePath.Contains("token"));
    }

    [Fact]
    public async Task CreateFeatureAsync_WithNearExpirySession_RefreshesAndPersists()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse(
                "{\"token_endpoint\":\"https://auth.example.test/connect/token\",\"device_authorization_endpoint\":\"https://auth.example.test/connect/deviceauthorization\"}"),
            "/connect/token" => JsonResponse(
                "{\"access_token\":\"refreshed-token\",\"refresh_token\":\"refresh-2\",\"expires_in\":3600,\"token_type\":\"Bearer\"}"),
            "/applications/app-1/features" => JsonResponse("{\"name\":\"Payments\",\"featureKey\":\"payments-enabled\"}"),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var store = new InMemorySecureTokenStore();
        var session = new AuthSession
        {
            AccessToken = "stale-token",
            RefreshToken = "refresh-1",
            ExpiresAtUtc = DateTime.UtcNow.AddMinutes(2),
            Authority = "https://auth.example.test",
            ClientId = Constants.DefaultDeviceClientId,
            TokenType = "Bearer"
        };
        await store.SaveAsync(session);

        var apiClient = new TogglyApiClient(
            httpClient,
            new AuthService(httpClient),
            "https://api.example.test/",
            new ResolvedCredentials
            {
                Kind = ResolvedAuthKind.DeviceSession,
                ClientId = session.ClientId,
                Authority = session.Authority,
                Session = session
            },
            store);

        await apiClient.CreateFeatureAsync("app-1", new()
        {
            Name = "Payments",
            FeatureKey = "payments-enabled"
        });

        var apiRequest = Assert.Single(handler.Requests, r => r.RequestUri!.AbsolutePath == "/applications/app-1/features");
        Assert.Equal("refreshed-token", apiRequest.Headers.Authorization!.Parameter);

        var persisted = await store.LoadAsync();
        Assert.NotNull(persisted);
        Assert.Equal("refreshed-token", persisted!.AccessToken);
        Assert.Equal("refresh-2", persisted.RefreshToken);
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
