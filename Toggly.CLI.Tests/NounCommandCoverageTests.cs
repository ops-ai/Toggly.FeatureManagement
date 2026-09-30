using System.CommandLine;
using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class NounCommandCoverageTests
{
    [Fact]
    public async Task AppGet_EnvListGet_FeatureList_ReleaseListGet_Succeed()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/applications/app-1" => JsonResponse("""{"id":"app-1","name":"Payments","description":"Billing","environments":["Production"],"defaultEnvironment":"Production","definitionsCount":1}"""),
            "/applications/app-1/environments" => JsonResponse("""[{"name":"Production","description":"prod","type":"Production","isActive":true,"activeFeatures":2,"promoteTo":["Staging"]}]"""),
            "/applications/app-1/environments/Production" => JsonResponse("""{"name":"Production","isActive":true,"activeFeatures":2}"""),
            "/applications/app-1/features" => JsonResponse("""[{"name":"Pay","featureKey":"pay","description":"d","category":"Billing"}]"""),
            "/releases" => JsonResponse("""[{"id":"r1","applicationId":"app-1","name":"v1","overallStatus":"Draft","featureChangesCount":1,"ciLinksCount":0}]"""),
            "/releases/r1" => JsonResponse("""{"id":"r1","applicationId":"app-1","name":"v1","overallStatus":"Draft","releaseNotes":"notes"}"""),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var http = new HttpClient(handler);
        var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
        var stdout = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => api, outputWriter: stdout);

        Assert.Equal(0, await command.InvokeAsync(["app", "get", "app-1"]));
        Assert.Equal(0, await command.InvokeAsync(["env", "list", "--app", "app-1"]));
        Assert.Equal(0, await command.InvokeAsync(["env", "get", "--app", "app-1", "Production"]));
        Assert.Equal(0, await command.InvokeAsync(["feature", "list", "--application-id", "app-1"]));
        Assert.Equal(0, await command.InvokeAsync(["release", "list", "--app", "app-1"]));
        Assert.Equal(0, await command.InvokeAsync(["--json", "release", "get", "r1"]));

        Assert.Contains("Payments", stdout.ToString());
        Assert.Contains("Production", stdout.ToString());
        using var doc = JsonDocument.Parse(stdout.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries).Last(l => l.StartsWith('{')));
        Assert.Equal("r1", doc.RootElement.GetProperty("id").GetString());
    }

    [Fact]
    public async Task MissingApp_ReturnsExitCode2()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-noapp-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            using var handler = new RecordingHandler(_ => JsonResponse("[]"));
            using var http = new HttpClient(handler);
            var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
            var stderr = new StringWriter();
            var command = CliApplication.CreateRootCommand(
                _ => api,
                contextStoreFactory: () => new ContextStore(tempDir),
                errorWriter: stderr);

            Assert.Equal(2, await command.InvokeAsync(["feature", "list"]));
            Assert.Contains("--app", stderr.ToString());
            Assert.Empty(handler.Requests);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public async Task AppGet_NotFound_ReturnsExitCode1()
    {
        using var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var http = new HttpClient(handler);
        var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => api, errorWriter: stderr);

        Assert.Equal(1, await command.InvokeAsync(["app", "get", "missing"]));
        Assert.Contains("not found", stderr.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task EmptyLists_EmitHumanPlaceholders()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var http = new HttpClient(handler);
        var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
        var stdout = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => api, outputWriter: stdout);

        Assert.Equal(0, await command.InvokeAsync(["app", "list"]));
        Assert.Equal(0, await command.InvokeAsync(["env", "list", "--app", "app-1"]));
        Assert.Equal(0, await command.InvokeAsync(["feature", "list", "--app", "app-1"]));
        Assert.Equal(0, await command.InvokeAsync(["release", "list"]));

        var text = stdout.ToString();
        Assert.Contains("No applications found.", text);
        Assert.Contains("No environments found.", text);
        Assert.Contains("No features found.", text);
        Assert.Contains("No releases found.", text);
    }

    [Fact]
    public async Task FlatAliases_StillInvokeWriteHandlers()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/applications/app-1/features" => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""),
            "/releases" => JsonResponse("""{"id":"r1","applicationId":"app-1","name":"v1"}"""),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var http = new HttpClient(handler);
        var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
        var command = CliApplication.CreateRootCommand(_ => api);

        Assert.Equal(0, await command.InvokeAsync([
            "create-feature", "--application-id", "app-1", "--name", "Pay", "--feature-key", "pay"
        ]));
        Assert.Equal(0, await command.InvokeAsync([
            "feature", "create", "--app", "app-1", "--name", "Pay", "--feature-key", "pay"
        ]));
        Assert.Equal(0, await command.InvokeAsync([
            "create-release", "--application-id", "app-1", "--name", "v1"
        ]));
        Assert.Equal(3, handler.Requests.Count);
    }

    [Fact]
    public async Task ContextGet_Json_EmitsObject()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-ctx-json-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            new ContextStore(tempDir).Save(new Models.ContextPrefs
            {
                DefaultApplicationId = "app-json",
                DefaultEnvironment = "Staging"
            });
            var stdout = new StringWriter();
            var command = CliApplication.CreateRootCommand(
                _ => null!,
                contextStoreFactory: () => new ContextStore(tempDir),
                outputWriter: stdout);

            Assert.Equal(0, await command.InvokeAsync(["--json", "context", "get"]));
            using var doc = JsonDocument.Parse(stdout.ToString());
            Assert.Equal("app-json", doc.RootElement.GetProperty("defaultApplicationId").GetString());
            Assert.Equal("Staging", doc.RootElement.GetProperty("defaultEnvironment").GetString());
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
