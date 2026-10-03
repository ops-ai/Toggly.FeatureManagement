using System.CommandLine;
using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Services;
using Toggly.CLI.UnleashMigration;
using Xunit;

namespace Toggly.CLI.Tests;

public class MigrateUnleashCommandTests
{
    private const string SampleExportJson = """
        {
          "version": 2,
          "features": [
            {
              "name": "welcome-banner",
              "enabled": true,
              "description": "Default strategy always on",
              "strategies": [
                { "name": "default", "parameters": {}, "constraints": [], "disabled": false }
              ]
            },
            {
              "name": "beta-users",
              "enabled": true,
              "strategies": [
                {
                  "name": "userWithId",
                  "parameters": { "userIds": "alice,bob" },
                  "constraints": [],
                  "disabled": false
                }
              ]
            },
            {
              "name": "gradual-checkout",
              "enabled": true,
              "strategies": [
                {
                  "name": "flexibleRollout",
                  "parameters": {
                    "rollout": "35",
                    "stickiness": "userId",
                    "groupId": "gradual-checkout"
                  },
                  "constraints": [],
                  "disabled": false
                }
              ]
            },
            {
              "name": "legacy-plugin-flag",
              "enabled": true,
              "strategies": [
                {
                  "name": "myCustomStrategy",
                  "parameters": { "magic": "true" },
                  "constraints": [],
                  "disabled": false
                }
              ]
            }
          ]
        }
        """;

    [Fact]
    public void Parser_AcceptsAdminApiWrapperShape()
    {
        var parsed = UnleashExportParser.Parse(SampleExportJson);
        Assert.Equal("Admin API wrapper { version, features }", parsed.AcceptedShape);
        Assert.Equal(4, parsed.Features.Count);
    }

    [Fact]
    public void Mapper_Targeting_UsesFlattenedAudienceKeys()
    {
        var strategy = new UnleashStrategyDto
        {
            Name = "userWithId",
            Parameters = new Dictionary<string, string> { ["userIds"] = "alice,bob" }
        };

        var result = UnleashStrategyMapper.Map([strategy]);

        Assert.Equal(UnleashMappingStatus.Mapped, result.Status);
        var filter = Assert.Single(result.Filters);
        Assert.Equal("Targeting", filter.Name);
        Assert.Equal("alice", filter.Parameters!["Audience.Users:0"]);
        Assert.Equal("bob", filter.Parameters!["Audience.Users:1"]);
        Assert.False(filter.Parameters.ContainsKey("Audience.Users"));
    }

    [Fact]
    public async Task DryRun_PrintsReport_WithoutApiMutations()
    {
        var exportPath = WriteTempExport(SampleExportJson);
        try
        {
            using var handler = new RecordingHandler(_ => JsonResponse("[]"));
            using var http = new HttpClient(handler);
            var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
            var stdout = new StringWriter();
            var command = CliApplication.CreateRootCommand(_ => api, outputWriter: stdout);

            var exitCode = await command.InvokeAsync([
                "migrate", "unleash",
                "--file", exportPath,
                "--app", "app-1",
                "--environment", "Production"
            ]);

            Assert.Equal(0, exitCode);
            Assert.Empty(handler.Requests);
            var text = stdout.ToString();
            Assert.Contains("Dry-run", text);
            Assert.Contains("welcome-banner", text);
            Assert.Contains("legacy-plugin-flag", text);
            Assert.Contains("Mapped:", text);
            Assert.Contains("will import as disabled/off", text);
            Assert.Contains("WARN: Skipped strategies for 'legacy-plugin-flag'", text);
        }
        finally
        {
            File.Delete(exportPath);
        }
    }

    [Theory]
    [InlineData("")]
    [InlineData("   \n\t  ")]
    public async Task EmptyOrWhitespaceExport_ReturnsNonZero(string content)
    {
        var exportPath = WriteTempExport(content);
        try
        {
            using var handler = new RecordingHandler(_ => JsonResponse("[]"));
            using var http = new HttpClient(handler);
            var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
            var stderr = new StringWriter();
            var command = CliApplication.CreateRootCommand(_ => api, errorWriter: stderr);

            var exitCode = await command.InvokeAsync([
                "migrate", "unleash",
                "--file", exportPath,
                "--app", "app-1",
                "--env", "Production"
            ]);

            Assert.NotEqual(0, exitCode);
            Assert.Empty(handler.Requests);
            Assert.Contains("Failed to parse Unleash export", stderr.ToString());
        }
        finally
        {
            File.Delete(exportPath);
        }
    }

    [Fact]
    public async Task DryRun_ParseFailure_ReturnsNonZero()
    {
        var exportPath = WriteTempExport("""{ "toggles": [] }""");
        try
        {
            using var handler = new RecordingHandler(_ => JsonResponse("[]"));
            using var http = new HttpClient(handler);
            var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
            var stderr = new StringWriter();
            var command = CliApplication.CreateRootCommand(_ => api, errorWriter: stderr);

            var exitCode = await command.InvokeAsync([
                "migrate", "unleash",
                "--file", exportPath,
                "--app", "app-1",
                "--env", "Production"
            ]);

            Assert.Equal(1, exitCode);
            Assert.Empty(handler.Requests);
            Assert.Contains("Failed to parse", stderr.ToString());
        }
        finally
        {
            File.Delete(exportPath);
        }
    }

    [Fact]
    public async Task Apply_CreatesMissingFeatures_AndUpdatesExisting()
    {
        var exportPath = WriteTempExport(SampleExportJson);
        try
        {
            using var handler = new RecordingHandler(request =>
            {
                var path = request.RequestUri!.AbsolutePath;
                if (request.Method == HttpMethod.Get && path == "/applications/app-1/features")
                {
                    return JsonResponse("""
                        [{"name":"Beta","featureKey":"beta-users","description":"existing"}]
                        """);
                }

                if (request.Method == HttpMethod.Post && path == "/applications/app-1/features")
                    return JsonResponse("""{"name":"created","featureKey":"created"}""");

                if (request.Method == HttpMethod.Put
                    && path.StartsWith("/applications/app-1/environments/Production/features/", StringComparison.Ordinal))
                    return JsonResponse("[]");

                return new HttpResponseMessage(HttpStatusCode.NotFound);
            });
            using var http = new HttpClient(handler);
            var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
            var stdout = new StringWriter();
            var command = CliApplication.CreateRootCommand(_ => api, outputWriter: stdout);

            var exitCode = await command.InvokeAsync([
                "migrate", "unleash",
                "--file", exportPath,
                "--app", "app-1",
                "--environment", "Production",
                "--apply"
            ]);

            Assert.Equal(0, exitCode);

            var posts = handler.Requests.Where(r => r.Method == HttpMethod.Post).ToList();
            var puts = handler.Requests.Where(r => r.Method == HttpMethod.Put).ToList();
            var gets = handler.Requests.Where(r => r.Method == HttpMethod.Get).ToList();

            Assert.Single(gets);
            // 3 creates (welcome, gradual, legacy) + 1 update (beta-users existing)
            Assert.Equal(3, posts.Count);
            Assert.Single(puts);
            Assert.Equal(
                "/applications/app-1/environments/Production/features/beta-users",
                puts[0].RequestUri!.AbsolutePath);

            // Targeting create uses flattened Audience.Users:N keys
            var betaCreateOrUpdate = puts[0];
            using var putDoc = JsonDocument.Parse(await betaCreateOrUpdate.Content!.ReadAsStringAsync());
            var targeting = Assert.Single(putDoc.RootElement.EnumerateArray());
            Assert.Equal("Targeting", targeting.GetProperty("name").GetString());
            Assert.Equal("alice", targeting.GetProperty("parameters").GetProperty("Audience.Users:0").GetString());

            Assert.Contains("Created: 3", stdout.ToString());
            Assert.Contains("Updated: 1", stdout.ToString());
        }
        finally
        {
            File.Delete(exportPath);
        }
    }

    [Fact]
    public async Task ApplyAndDryRun_Together_Fails()
    {
        var exportPath = WriteTempExport(SampleExportJson);
        try
        {
            using var handler = new RecordingHandler(_ => JsonResponse("[]"));
            using var http = new HttpClient(handler);
            var api = new TogglyApiClient(http, new AuthService(http), "https://api.example.test");
            var stderr = new StringWriter();
            var command = CliApplication.CreateRootCommand(_ => api, errorWriter: stderr);

            var exitCode = await command.InvokeAsync([
                "migrate", "unleash",
                "--file", exportPath,
                "--app", "app-1",
                "--env", "Production",
                "--dry-run",
                "--apply"
            ]);

            Assert.Equal(2, exitCode);
            Assert.Empty(handler.Requests);
            Assert.Contains("either --apply or --dry-run", stderr.ToString());
        }
        finally
        {
            File.Delete(exportPath);
        }
    }

    private static string WriteTempExport(string json)
    {
        var path = Path.Combine(Path.GetTempPath(), "unleash-export-" + Guid.NewGuid().ToString("N") + ".json");
        File.WriteAllText(path, json);
        return path;
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
