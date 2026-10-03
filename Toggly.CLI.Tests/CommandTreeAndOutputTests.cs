using System.CommandLine;
using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class CommandTreeAndOutputTests
{
    [Fact]
    public void RootCommand_ContainsNounsAndFlatAliases()
    {
        var root = CliApplication.CreateRootCommand(_ => null!);
        var names = root.Children.OfType<Command>().Select(c => c.Name).ToHashSet(StringComparer.Ordinal);

        Assert.Contains("auth", names);
        Assert.Contains("app", names);
        Assert.Contains("env", names);
        Assert.Contains("feature", names);
        Assert.Contains("release", names);
        Assert.Contains("migrate", names);
        Assert.Contains("context", names);
        Assert.Contains("create-feature", names);
        Assert.Contains("update-feature", names);
        Assert.Contains("update-feature-environment", names);
        Assert.Contains("create-release", names);
        Assert.Contains("associate-build", names);
        Assert.Contains(root.Options, o => o.Name == "--json" || o.Aliases.Contains("--json"));
    }

    [Fact]
    public async Task AppList_Json_EmitsParseableArray()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""
            [{"id":"app-1","name":"Payments","description":"Billing","environments":["Production"],"defaultEnvironment":"Production","definitionsCount":2}]
            """));
        using var httpClient = new HttpClient(handler);
        var apiClient = new TogglyApiClient(httpClient, new AuthService(httpClient), "https://api.example.test");
        var stdout = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => apiClient, outputWriter: stdout);

        var exitCode = await command.InvokeAsync(["--json", "app", "list"]);
        Assert.Equal(0, exitCode);

        using var document = JsonDocument.Parse(stdout.ToString());
        Assert.Equal(JsonValueKind.Array, document.RootElement.ValueKind);
        Assert.Equal("app-1", document.RootElement[0].GetProperty("id").GetString());
        Assert.Equal(HttpMethod.Get, Assert.Single(handler.Requests).Method);
        Assert.Equal("/applications", handler.Requests[0].RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task AppList_Human_EmitsTextLines()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""
            [{"id":"app-1","name":"Payments"}]
            """));
        using var httpClient = new HttpClient(handler);
        var apiClient = new TogglyApiClient(httpClient, new AuthService(httpClient), "https://api.example.test");
        var stdout = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => apiClient, outputWriter: stdout);

        var exitCode = await command.InvokeAsync(["app", "list"]);
        Assert.Equal(0, exitCode);

        var text = stdout.ToString();
        Assert.Contains("app-1", text);
        Assert.Contains("Payments", text);
        Assert.DoesNotContain("[{\"id\"", text);
    }

    [Fact]
    public async Task FeatureGet_UsesAppFromContextPrefs()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "toggly-cli-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            var store = new ContextStore(tempDir);
            store.Save(new Models.ContextPrefs { DefaultApplicationId = "app-from-prefs" });

            using var handler = new RecordingHandler(_ => JsonResponse("""
                {"name":"Payments","featureKey":"payments-enabled"}
                """));
            using var httpClient = new HttpClient(handler);
            var apiClient = new TogglyApiClient(httpClient, new AuthService(httpClient), "https://api.example.test");
            var command = CliApplication.CreateRootCommand(
                _ => apiClient,
                contextStoreFactory: () => new ContextStore(tempDir));

            var exitCode = await command.InvokeAsync(["feature", "get", "payments-enabled"]);
            Assert.Equal(0, exitCode);
            var request = Assert.Single(handler.Requests);
            Assert.Equal("/applications/app-from-prefs/features/payments-enabled", request.RequestUri!.AbsolutePath);
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
