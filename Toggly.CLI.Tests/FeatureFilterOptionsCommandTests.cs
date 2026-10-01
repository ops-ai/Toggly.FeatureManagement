using System.CommandLine;
using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

/// <summary>
/// Covers first-class filter-builder options and variant/allocation wiring on
/// <c>create-feature</c>, <c>update-feature</c>, and <c>update-feature-environment</c>
/// (OPS-1646 slice 1).
/// </summary>
public class FeatureFilterOptionsCommandTests
{
    [Fact]
    public async Task UpdateFeatureEnvironment_Percentage_BuildsPercentageFilter()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled", "--percentage", "25"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var filter = Assert.Single(document.RootElement.EnumerateArray());
        Assert.Equal("Percentage", filter.GetProperty("name").GetString());
        Assert.Equal(25, filter.GetProperty("parameters").GetProperty("Value").GetDouble());
    }

    [Fact]
    public async Task UpdateFeatureEnvironment_Targeting_BuildsFlattenedAudienceKeys()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled",
            "--targeting-users", "alice,bob",
            "--targeting-default-rollout", "25",
            "--targeting-ignore-case"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var filter = Assert.Single(document.RootElement.EnumerateArray());
        Assert.Equal("Targeting", filter.GetProperty("name").GetString());
        var parameters = filter.GetProperty("parameters");
        Assert.Equal("alice", parameters.GetProperty("Audience.Users:0").GetString());
        Assert.Equal("bob", parameters.GetProperty("Audience.Users:1").GetString());
        Assert.Equal(25, parameters.GetProperty("Audience.DefaultRolloutPercentage").GetDouble());
        Assert.True(parameters.GetProperty("IgnoreCase").GetBoolean());
    }

    [Fact]
    public async Task UpdateFeatureEnvironment_TimeWindow_BuildsStartAndEnd()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled",
            "--time-window-start", "2020-01-01T00:00:00Z",
            "--time-window-end", "2099-12-31T23:59:59Z"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var filter = Assert.Single(document.RootElement.EnumerateArray());
        Assert.Equal("TimeWindow", filter.GetProperty("name").GetString());
        Assert.True(filter.GetProperty("parameters").TryGetProperty("Start", out _));
        Assert.True(filter.GetProperty("parameters").TryGetProperty("End", out _));
    }

    [Fact]
    public async Task UpdateFeatureEnvironment_CombinesPercentageAndFiltersJson()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled", "--percentage", "10",
            "--filters", """[{"name":"UserClaims","parameters":{"Claim":"role","Value":"admin"}}]"""
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var names = document.RootElement.EnumerateArray().Select(e => e.GetProperty("name").GetString()).ToArray();
        Assert.Contains("Percentage", names);
        Assert.Contains("UserClaims", names);
    }

    [Fact]
    public async Task UpdateFeatureEnvironment_DisableCombinedWithPercentage_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled", "--disable", "--percentage", "10"
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("--disable cannot be combined", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UpdateFeatureEnvironment_NoOptions_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled"
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("Must specify one of", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UpdateFeatureEnvironment_InvalidFiltersJson_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("[]"));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "update-feature-environment", "--application-id", "app-1", "--environment", "Production",
            "--feature-key", "payments-enabled", "--filters", """[{"name":"NotReal"}]"""
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("Unknown filter name", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task CreateFeature_PercentageWithEnvironment_PopulatesEnvironmentFilters()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "create-feature", "--application-id", "app-1", "--name", "Pay", "--feature-key", "pay",
            "--environment", "Production", "--percentage", "50"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var filters = document.RootElement.GetProperty("environmentFilters").GetProperty("Production");
        var filter = Assert.Single(filters.EnumerateArray());
        Assert.Equal("Percentage", filter.GetProperty("name").GetString());
    }

    [Fact]
    public async Task CreateFeature_FilterOptionsWithoutEnvironment_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "create-feature", "--application-id", "app-1", "--name", "Pay", "--feature-key", "pay",
            "--percentage", "50"
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("require --environment", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task CreateFeature_InvalidEnvironmentFiltersJson_FailsValidation()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "create-feature", "--application-id", "app-1", "--name", "Pay", "--feature-key", "pay",
            "--environment-filters", """{"Production":[{"name":"NotReal","parameters":{}}]}"""
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("Unknown filter name", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task CreateFeature_Variants_And_Allocation_AreSent()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "create-feature", "--application-id", "app-1", "--name", "Pay", "--feature-key", "pay",
            "--variants", """[{"name":"Control","configurationValue":false},{"name":"Treatment","configurationValue":true}]""",
            "--allocation", """{"percentile":[{"variant":"Control","from":0,"to":50},{"variant":"Treatment","from":50,"to":100}]}"""
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(2, document.RootElement.GetProperty("variants").GetArrayLength());
        Assert.Equal(2, document.RootElement.GetProperty("allocation").GetProperty("percentile").GetArrayLength());
    }

    [Fact]
    public async Task CreateFeature_AllocationReferencingUnknownVariant_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "create-feature", "--application-id", "app-1", "--name", "Pay", "--feature-key", "pay",
            "--variants", """[{"name":"Control"}]""",
            "--allocation", """{"defaultWhenEnabled":"Ghost"}"""
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("unknown variant 'Ghost'", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UpdateFeature_Variants_And_Allocation_AreSent()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature", "--application-id", "app-1", "--feature-key", "pay",
            "--variants", """[{"name":"Control"},{"name":"Treatment"}]""",
            "--allocation", """{"defaultWhenEnabled":"Control"}"""
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Equal(2, document.RootElement.GetProperty("variants").GetArrayLength());
        Assert.Equal("Control", document.RootElement.GetProperty("allocation").GetProperty("defaultWhenEnabled").GetString());
    }

    [Fact]
    public async Task UpdateFeature_Percentage_SetsDefinitionLevelBaseFilters()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature", "--application-id", "app-1", "--feature-key", "pay", "--percentage", "40"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        var filter = Assert.Single(document.RootElement.GetProperty("filters").EnumerateArray());
        Assert.Equal("Percentage", filter.GetProperty("name").GetString());
        Assert.Equal(40, filter.GetProperty("parameters").GetProperty("Value").GetDouble());
    }

    [Fact]
    public async Task UpdateFeature_WithoutFilterOptions_SendsEmptyFiltersArray()
    {
        // Pre-existing behavior (not changed by this slice): metadata-only updates
        // currently always send an empty "filters" array because the CLI does not
        // fetch-then-merge before PUT. This is a known follow-up, not introduced here.
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);

        var exitCode = await CreateCommand(client).InvokeAsync([
            "update-feature", "--application-id", "app-1", "--feature-key", "pay", "--name", "Pay"
        ]);

        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        using var document = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
        Assert.Empty(document.RootElement.GetProperty("filters").EnumerateArray());
    }

    [Fact]
    public async Task UpdateFeature_InvalidFiltersJson_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "update-feature", "--application-id", "app-1", "--feature-key", "pay",
            "--filters", """[{"name":"NotReal"}]"""
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("Unknown filter name", stderr.ToString());
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task UpdateFeature_InvalidVariantsJson_Fails()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""{"name":"Pay","featureKey":"pay"}"""));
        using var client = CreateHttpClient(handler);
        var stderr = new StringWriter();
        var command = CliApplication.CreateRootCommand(_ => new TogglyApiClient(client, new AuthService(client), "https://api.example.test"), errorWriter: stderr);

        var exitCode = await command.InvokeAsync([
            "update-feature", "--application-id", "app-1", "--feature-key", "pay",
            "--variants", """[{"name":"A"},{"name":"a"}]"""
        ]);

        Assert.Equal(2, exitCode);
        Assert.Contains("Duplicate variant name", stderr.ToString());
        Assert.Empty(handler.Requests);
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
