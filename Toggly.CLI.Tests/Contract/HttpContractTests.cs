using System.CommandLine;
using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests.Contract;

/// <summary>
/// Merge-blocking HTTP contracts for every curated CLI management-API command.
/// </summary>
public class HttpContractTests
{
    private const string AppId = "app-1";
    private const string FeatureKey = "pay";
    private const string EnvName = "Production";
    private const string ReleaseId = "r1";

    [Fact]
    public async Task AppList_GetsApplications()
    {
        var request = await InvokeAndCapture(
            ["app", "list"],
            path => path == CliApiRoutes.Applications
                ? ContractHttp.Json("""[{"id":"app-1","name":"App"}]""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.Applications);
    }

    [Fact]
    public async Task AppGet_GetsById()
    {
        var request = await InvokeAndCapture(
            ["app", "get", AppId],
            path => path == CliApiRoutes.Application(AppId)
                ? ContractHttp.Json("""{"id":"app-1","name":"App"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.Application(AppId));
    }

    [Fact]
    public async Task EnvList_GetsEnvironments()
    {
        var request = await InvokeAndCapture(
            ["env", "list", "--app", AppId],
            path => path == CliApiRoutes.EnvironmentList(AppId)
                ? ContractHttp.Json("""[{"name":"Production","isActive":true}]""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.EnvironmentList(AppId));
    }

    [Fact]
    public async Task EnvGet_GetsByName()
    {
        var request = await InvokeAndCapture(
            ["env", "get", "--app", AppId, EnvName],
            path => path == CliApiRoutes.Environment(AppId, EnvName)
                ? ContractHttp.Json("""{"name":"Production","isActive":true}""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.Environment(AppId, EnvName));
    }

    [Fact]
    public async Task FeatureList_GetsFeatures()
    {
        var request = await InvokeAndCapture(
            ["feature", "list", "--app", AppId],
            path => path == CliApiRoutes.FeatureList(AppId)
                ? ContractHttp.Json("""[{"name":"Pay","featureKey":"pay"}]""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.FeatureList(AppId));
    }

    [Fact]
    public async Task FeatureGet_GetsByKey()
    {
        var request = await InvokeAndCapture(
            ["feature", "get", "--app", AppId, FeatureKey],
            path => path == CliApiRoutes.Feature(AppId, FeatureKey)
                ? ContractHttp.Json("""{"name":"Pay","featureKey":"pay"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.Feature(AppId, FeatureKey));
    }

    [Fact]
    public async Task FeatureCreate_PostsBodyShape()
    {
        var request = await InvokeAndCapture(
            ["feature", "create", "--app", AppId, "--name", "Pay", "--feature-key", FeatureKey],
            path => path == CliApiRoutes.FeatureList(AppId)
                ? ContractHttp.Json("""{"name":"Pay","featureKey":"pay"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Post, CliApiRoutes.FeatureList(AppId));
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("Pay", body.RootElement.GetProperty("name").GetString());
        Assert.Equal(FeatureKey, body.RootElement.GetProperty("featureKey").GetString());
    }

    [Fact]
    public async Task FeatureUpdate_PutsBodyShape()
    {
        var request = await InvokeAndCapture(
            ["feature", "update", "--app", AppId, "--feature-key", FeatureKey, "--description", "Updated"],
            path => path == CliApiRoutes.Feature(AppId, FeatureKey)
                ? ContractHttp.Json("""{"name":"Pay","featureKey":"pay","description":"Updated"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Put, CliApiRoutes.Feature(AppId, FeatureKey));
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(FeatureKey, body.RootElement.GetProperty("featureKey").GetString());
        Assert.Equal("Updated", body.RootElement.GetProperty("description").GetString());
    }

    [Fact]
    public async Task FeatureUpdateEnvironment_PutsFilters()
    {
        var pathExpected = CliApiRoutes.FeatureInEnvironment(AppId, EnvName, FeatureKey);
        var request = await InvokeAndCapture(
            ["feature", "update-environment", "--app", AppId, "--env", EnvName, "--feature-key", FeatureKey, "--enable"],
            path => path == pathExpected ? ContractHttp.Json("[]") : NotFound());

        AssertContract(request, HttpMethod.Put, pathExpected);
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("AlwaysOn", Assert.Single(body.RootElement.EnumerateArray()).GetProperty("name").GetString());
    }

    [Fact]
    public async Task ReleaseList_GetsReleases()
    {
        var request = await InvokeAndCapture(
            ["release", "list"],
            path => path == CliApiRoutes.Releases
                ? ContractHttp.Json("""[{"id":"r1","applicationId":"app-1","name":"v1"}]""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.Releases);
    }

    [Fact]
    public async Task ReleaseGet_GetsById()
    {
        var request = await InvokeAndCapture(
            ["release", "get", ReleaseId],
            path => path == CliApiRoutes.Release(ReleaseId)
                ? ContractHttp.Json("""{"id":"r1","applicationId":"app-1","name":"v1"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Get, CliApiRoutes.Release(ReleaseId));
    }

    [Fact]
    public async Task ReleaseCreate_PostsBodyShape()
    {
        var request = await InvokeAndCapture(
            ["release", "create", "--app", AppId, "--name", "v1.0"],
            path => path == CliApiRoutes.Releases
                ? ContractHttp.Json("""{"id":"r1","applicationId":"app-1","name":"v1.0"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Post, CliApiRoutes.Releases);
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(AppId, body.RootElement.GetProperty("applicationId").GetString());
        Assert.Equal("v1.0", body.RootElement.GetProperty("name").GetString());
        Assert.True(body.RootElement.TryGetProperty("featureChanges", out _));
    }

    [Fact]
    public async Task ReleaseAssociateBuild_PostsBodyShape()
    {
        var request = await InvokeAndCapture(
            [
                "release", "associate-build",
                "--project-key", AppId,
                "--env", EnvName,
                "--ci-provider", "github",
                "--run-id", "42",
                "--pipeline-name", "deploy"
            ],
            path => path == CliApiRoutes.AssociateBuild
                ? ContractHttp.Json("""{"releaseId":"r1"}""")
                : NotFound());

        AssertContract(request, HttpMethod.Post, CliApiRoutes.AssociateBuild);
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(AppId, body.RootElement.GetProperty("projectKey").GetString());
        Assert.Equal(EnvName, body.RootElement.GetProperty("environment").GetString());
        Assert.Equal("github", body.RootElement.GetProperty("ciProvider").GetString());
        Assert.Equal("42", body.RootElement.GetProperty("build").GetProperty("runId").GetString());
    }

    [Theory]
    [InlineData(new[] { "create-feature", "--app", "app-1", "--name", "Pay", "--feature-key", "pay" }, "POST", "/applications/app-1/features")]
    [InlineData(new[] { "update-feature", "--app", "app-1", "--feature-key", "pay", "--description", "d" }, "PUT", "/applications/app-1/features/pay")]
    [InlineData(new[] { "update-feature-environment", "--app", "app-1", "--env", "Production", "--feature-key", "pay", "--enable" }, "PUT", "/applications/app-1/environments/Production/features/pay")]
    [InlineData(new[] { "create-release", "--app", "app-1", "--name", "v1" }, "POST", "/releases")]
    [InlineData(new[] { "associate-build", "--project-key", "app-1", "--env", "Production", "--ci-provider", "github", "--run-id", "1", "--pipeline-name", "p" }, "POST", "/releases/associate-build")]
    public async Task FlatAliases_HitSamePathsAsNounCommands(string[] args, string method, string path)
    {
        var request = await InvokeAndCapture(
            args,
            requestPath => requestPath == path
                ? ContractHttp.Json(DefaultJsonForPath(path))
                : NotFound());

        AssertContract(request, new HttpMethod(method), path);
    }

    [Fact]
    public async Task ApiClient_WithClientCredentials_SetsAuthorizationBearer()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => ContractHttp.Json(
                """{"token_endpoint":"https://auth.example.test/connect/token"}"""),
            "/connect/token" => ContractHttp.Json("""{"access_token":"tok","expires_in":3600,"token_type":"Bearer"}"""),
            "/applications" => ContractHttp.Json("""[]"""),
            _ => NotFound()
        });
        using var http = new HttpClient(handler);
        var client = new TogglyApiClient(
            http,
            new AuthService(http),
            "https://api.example.test",
            "client",
            "secret",
            "https://auth.example.test");

        await client.ListApplicationsAsync();

        var apiRequest = handler.Requests.Last(r => r.RequestUri!.AbsolutePath == CliApiRoutes.Applications);
        Assert.Equal("Bearer", apiRequest.Headers.Authorization!.Scheme);
        Assert.Equal("tok", apiRequest.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task ApiClient_CreateFeature_UsesRouteTablePath()
    {
        using var handler = new RecordingHandler(_ =>
            ContractHttp.Json("""{"name":"Pay","featureKey":"pay"}"""));
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.example.test") };
        var client = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");

        await client.CreateFeatureAsync(AppId, new FeatureDefinitionCreateModel
        {
            Name = "Pay",
            FeatureKey = FeatureKey
        });

        AssertContract(Assert.Single(handler.Requests), HttpMethod.Post, CliApiRoutes.FeatureList(AppId));
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, "app", "get", "missing")]
    [InlineData(HttpStatusCode.Forbidden, "feature", "get", "--app", "app-1", "pay")]
    public async Task ApiErrors_ReturnExitCode1(HttpStatusCode status, params string[] args)
    {
        using var handler = new RecordingHandler(_ => new HttpResponseMessage(status)
        {
            Content = new StringContent("denied", Encoding.UTF8, "text/plain")
        });
        using var http = new HttpClient(handler);
        var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => api, errorWriter: stderr);

        Assert.Equal(1, await command.InvokeAsync(args));
        Assert.NotEmpty(stderr.ToString());
    }

    private static async Task<HttpRequestMessage> InvokeAndCapture(
        string[] args,
        Func<string, HttpResponseMessage> responseForPath)
    {
        using var handler = new RecordingHandler(request =>
            responseForPath(request.RequestUri!.AbsolutePath));
        using var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.example.test") };
        var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
        var command = CliApplication.CreateRootCommand(_ => api);

        var exit = await command.InvokeAsync(args);
        Assert.Equal(0, exit);
        return Assert.Single(handler.Requests);
    }

    private static void AssertContract(HttpRequestMessage request, HttpMethod method, string path)
    {
        Assert.Equal(method, request.Method);
        Assert.Equal(path, request.RequestUri!.AbsolutePath);
    }

    private static HttpResponseMessage NotFound() => new(HttpStatusCode.NotFound);

    private static string DefaultJsonForPath(string path) => path switch
    {
        "/applications/app-1/features" => """{"name":"Pay","featureKey":"pay"}""",
        "/applications/app-1/features/pay" => """{"name":"Pay","featureKey":"pay","description":"d"}""",
        "/applications/app-1/environments/Production/features/pay" => "[]",
        "/releases" => """{"id":"r1","applicationId":"app-1","name":"v1"}""",
        "/releases/associate-build" => """{"releaseId":"r1"}""",
        _ => "{}"
    };
}
