using System.Net;
using System.Text;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class TogglyApiClientListGetTests
{
    [Fact]
    public async Task ListApplicationsAsync_GetsApplications()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""[{"id":"a1","name":"App"}]"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var apps = await client.ListApplicationsAsync();

        Assert.Equal("a1", Assert.Single(apps).Id);
        AssertRequest(handler, HttpMethod.Get, "/applications");
    }

    [Fact]
    public async Task GetApplicationAsync_GetsById()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"id":"a1","name":"App"}"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var app = await client.GetApplicationAsync("a1");

        Assert.Equal("App", app.Name);
        AssertRequest(handler, HttpMethod.Get, "/applications/a1");
    }

    [Fact]
    public async Task ListEnvironmentsAsync_GetsEnvironments()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""[{"name":"Production","activeFeatures":3,"isActive":true}]"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var envs = await client.ListEnvironmentsAsync("app-1");

        Assert.Equal("Production", Assert.Single(envs).Name);
        AssertRequest(handler, HttpMethod.Get, "/applications/app-1/environments");
    }

    [Fact]
    public async Task GetEnvironmentAsync_GetsByName()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Staging","isActive":true}"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var env = await client.GetEnvironmentAsync("app-1", "Staging");

        Assert.Equal("Staging", env.Name);
        AssertRequest(handler, HttpMethod.Get, "/applications/app-1/environments/Staging");
    }

    [Fact]
    public async Task ListFeaturesAsync_GetsFeatures()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""[{"name":"Pay","featureKey":"pay"}]"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var features = await client.ListFeaturesAsync("app-1");

        Assert.Equal("pay", Assert.Single(features).FeatureKey);
        AssertRequest(handler, HttpMethod.Get, "/applications/app-1/features");
    }

    [Fact]
    public async Task GetFeatureAsync_GetsByKey()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var feature = await client.GetFeatureAsync("app-1", "pay");

        Assert.Equal("Pay", feature.Name);
        AssertRequest(handler, HttpMethod.Get, "/applications/app-1/features/pay");
    }

    [Fact]
    public async Task ListReleasesAsync_AppendsOptionalQuery()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""[{"id":"r1","applicationId":"app-1","name":"v1"}]"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var releases = await client.ListReleasesAsync("app-1", "Production", "Active", "v1");

        Assert.Equal("r1", Assert.Single(releases).Id);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("/releases", request.RequestUri!.AbsolutePath);
        Assert.Contains("applicationId=app-1", request.RequestUri.Query);
        Assert.Contains("environment=Production", request.RequestUri.Query);
        Assert.Contains("status=Active", request.RequestUri.Query);
        Assert.Contains("search=v1", request.RequestUri.Query);
    }

    [Fact]
    public async Task GetReleaseAsync_GetsById()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"id":"r1","applicationId":"app-1","name":"v1"}"""));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var release = await client.GetReleaseAsync("r1");

        Assert.Equal("v1", release.Name);
        AssertRequest(handler, HttpMethod.Get, "/releases/r1");
    }

    [Fact]
    public async Task GetApplicationAsync_NotFound_ThrowsClearError()
    {
        using var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => client.GetApplicationAsync("missing"));
        Assert.Contains("not found", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GetFeatureAsync_ApiError_IncludesStatusCode()
    {
        using var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.Forbidden)
        {
            Content = new StringContent("denied", Encoding.UTF8, "text/plain")
        });
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => client.GetFeatureAsync("app-1", "pay"));
        Assert.Contains("403", ex.Message);
        Assert.Contains("denied", ex.Message);
    }

    [Fact]
    public async Task GetEnvironmentAsync_NotFound_ThrowsClearError()
    {
        using var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var http = CreateHttp(handler);
        var client = CreateClient(http);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            client.GetEnvironmentAsync("app-1", "Missing"));
        Assert.Contains("not found", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static HttpClient CreateHttp(RecordingHandler handler) => new(handler)
    {
        BaseAddress = new Uri("https://api.example.test")
    };

    private static TogglyApiClient CreateClient(HttpClient httpClient) =>
        new(httpClient, new AuthService(httpClient), "https://api.example.test");

    private static void AssertRequest(RecordingHandler handler, HttpMethod method, string path)
    {
        var request = Assert.Single(handler.Requests);
        Assert.Equal(method, request.Method);
        Assert.Equal(path, request.RequestUri!.AbsolutePath);
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
