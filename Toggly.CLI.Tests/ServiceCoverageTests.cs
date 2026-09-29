using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class ServiceCoverageTests
{
    [Fact]
    public async Task GetAccessTokenAsync_UsesDiscoveryAndCachesTheToken()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("{\"token_endpoint\":\"https://auth.example.test/connect/token\"}"),
            "/connect/token" => JsonResponse("{\"access_token\":\"token-1\",\"expires_in\":3600,\"token_type\":\"Bearer\"}"),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var first = await service.GetAccessTokenAsync("client", "secret", "https://auth.example.test/");
        var second = await service.GetAccessTokenAsync("client", "secret", "https://auth.example.test/");

        Assert.Equal("token-1", first);
        Assert.Equal(first, second);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal("/.well-known/openid-configuration", handler.Requests[0].RequestUri!.AbsolutePath);
        Assert.Equal("/connect/token", handler.Requests[1].RequestUri!.AbsolutePath);
        var content = await handler.Requests[1].Content!.ReadAsStringAsync();
        Assert.Contains("grant_type=client_credentials", content);
    }

    [Fact]
    public void LoadConfig_UsesExplicitArgumentsAndCleansOwnedLegacyConfigDirectory()
    {
        var legacyConfigDirectory = Path.Combine(Path.GetTempPath(), $"toggly-cli-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(legacyConfigDirectory);
        File.WriteAllText(Path.Combine(legacyConfigDirectory, "config.json"), "legacy credentials");

        try
        {
            var service = new ConfigService(legacyConfigDirectory);

            var config = service.LoadConfig("id", "secret", "https://auth.example.test", "https://api.example.test/");

            Assert.Equal("id", config.ClientId);
            Assert.Equal("secret", config.ClientSecret);
            Assert.Equal("https://auth.example.test", config.Authority);
            Assert.Equal("https://api.example.test/", config.BaseUrl);
            Assert.False(Directory.Exists(legacyConfigDirectory));
            service.ValidateAuthConfig(config);
            Assert.Throws<InvalidOperationException>(() => service.ValidateAuthConfig(new()));
        }
        finally
        {
            if (Directory.Exists(legacyConfigDirectory))
                Directory.Delete(legacyConfigDirectory, recursive: true);
        }
    }

    [Fact]
    public async Task CreateFeatureAsync_AddsBearerTokenAndDeserializesTheResponse()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("{\"token_endpoint\":\"https://auth.example.test/connect/token\"}"),
            "/connect/token" => JsonResponse("{\"access_token\":\"token-1\",\"expires_in\":3600}"),
            "/applications/app-1/features" => JsonResponse("{\"name\":\"Payments\",\"featureKey\":\"payments-enabled\"}"),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var apiClient = new TogglyApiClient(
            httpClient,
            new AuthService(httpClient),
            "https://api.example.test/",
            "client",
            "secret",
            "https://auth.example.test");

        var feature = await apiClient.CreateFeatureAsync("app-1", new()
        {
            Name = "Payments",
            FeatureKey = "payments-enabled"
        });

        Assert.Equal("payments-enabled", feature.FeatureKey);
        var authorization = handler.Requests[^1].Headers.Authorization;
        Assert.NotNull(authorization);
        Assert.Equal("Bearer", authorization!.Scheme);
        Assert.Equal("token-1", authorization.Parameter);
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
