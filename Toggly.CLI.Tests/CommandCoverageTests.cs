using System.CommandLine;
using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class CommandCoverageTests
{
    [Fact]
    public async Task UpdateFeature_SendsSelectedFieldsAndTrimmedTags()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""
            {"name":"Payments","featureKey":"payments-enabled","description":"Controls payments"}
            """));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature", "--application-id", "app-1", "--feature-key", "payments-enabled",
            "--name", "Payments", "--description", "Controls payments", "--category", "Billing",
            "--tags", " critical, payments ,,"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Put, request.Method);
        Assert.Equal("/applications/app-1/features/payments-enabled", request.RequestUri!.AbsolutePath);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("Payments", document.RootElement.GetProperty("name").GetString());
        Assert.Equal("Billing", document.RootElement.GetProperty("category").GetString());
        Assert.Equal(
            new[] { "critical", "payments" },
            document.RootElement.GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()!).ToArray());
    }

    [Theory]
    [InlineData("--enable", "AlwaysOn")]
    [InlineData("--disable", null)]
    public async Task UpdateFeatureEnvironment_MapsEnableAndDisableToExpectedFilters(string mode, string? expectedFilterName)
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled", mode
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Put, request.Method);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var filters = document.RootElement.EnumerateArray().ToArray();
        if (expectedFilterName is null)
        {
            Assert.Empty(filters);
        }
        else
        {
            Assert.Equal(expectedFilterName, Assert.Single(filters).GetProperty("name").GetString());
        }
    }

    [Fact]
    public async Task CreateRelease_MapsFeatureChangesFromJson()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""
            {"id":"release-1","applicationId":"app-1","name":"v1.2.0","releaseNotes":"Release notes"}
            """));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "create-release", "--application-id", "app-1", "--name", "v1.2.0",
            "--release-notes", "Release notes",
            "--feature-changes", "[{\"flagKey\":\"payments-enabled\",\"toState\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("/releases", request.RequestUri!.AbsolutePath);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("payments-enabled", document.RootElement.GetProperty("featureChanges")[0].GetProperty("flagKey").GetString());
    }

    [Fact]
    public async Task AssociateBuild_MapsOptionalReleaseCreationOptions()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""
            {"releaseId":"release-1","releaseUrl":"https://app.example.test/releases/release-1"}
            """));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "associate-build", "--project-key", "ops-ai/Toggly", "--environment", "Production",
            "--ci-provider", "github", "--run-id", "42", "--pipeline-name", "deploy",
            "--run-url", "https://github.example.test/runs/42", "--branch", "develop",
            "--commit-sha", "abc123", "--build-number", "1.2.0", "--mode", "create",
            "--release-template-key", "standard", "--name-pattern", "${branch}-${buildNumber}"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("/releases/associate-build", request.RequestUri!.AbsolutePath);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal("create", document.RootElement.GetProperty("mode").GetString());
        Assert.Equal("standard", document.RootElement.GetProperty("releaseTemplateKey").GetString());
        Assert.Equal("${branch}-${buildNumber}", document.RootElement.GetProperty("createOptions").GetProperty("namePattern").GetString());
    }

    private static RootCommand CreateCommand(HttpClient httpClient)
    {
        var apiClient = new TogglyApiClient(httpClient, new AuthService(httpClient), "https://api.example.test");
        return CliApplication.CreateRootCommand(_ => apiClient);
    }

    private static HttpClient CreateHttpClient(RecordingHandler handler) => new(handler)
    {
        BaseAddress = new Uri("https://api.example.test")
    };

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
