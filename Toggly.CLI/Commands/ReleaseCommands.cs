using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// Release noun commands and flat write aliases.
/// </summary>
public static class ReleaseCommands
{
    private sealed record CreateReleaseOptionsBag(
        Option<string?> ApplicationId,
        Option<string> Name,
        Option<string?> ReleaseNotes,
        Option<string?> FeatureChanges);

    private sealed record AssociateBuildOptions(
        Option<string> ProjectKey,
        Option<string?> Environment,
        Option<string> CiProvider,
        Option<string> RunId,
        Option<string?> RunUrl,
        Option<string> PipelineName,
        Option<string?> Branch,
        Option<string?> CommitSha,
        Option<string?> BuildNumber,
        Option<string> Mode,
        Option<string?> ReleaseTemplateKey,
        Option<string?> NamePattern);

    /// <summary>
    /// Create the <c>release</c> noun group.
    /// </summary>
    public static Command CreateNoun(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var release = new Command("release", "List, inspect, and manage releases");
        release.AddCommand(CreateListCommand(apiClientFactory, cli));
        release.AddCommand(CreateGetCommand(apiClientFactory, cli));
        release.AddCommand(CreateCreateCommand("create", "Create a new release", apiClientFactory, cli));
        release.AddCommand(CreateAssociateBuildCommand(
            "associate-build",
            "Associate a CI build with a release",
            apiClientFactory,
            cli));
        return release;
    }

    /// <summary>Flat alias: <c>create-release</c>.</summary>
    public static Command CreateReleaseAlias(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli) =>
        CreateCreateCommand("create-release", "Create a new release", apiClientFactory, cli);

    /// <summary>Flat alias: <c>associate-build</c>.</summary>
    public static Command CreateAssociateBuildAlias(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli) =>
        CreateAssociateBuildCommand(
            "associate-build",
            "Associate a CI build with a release",
            apiClientFactory,
            cli);

    private static Command CreateListCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("list", "List releases");
        var appOption = CommandOptions.CreateAppOption();
        var environmentOption = CommandOptions.CreateEnvOption("Filter by environment");
        var statusOption = new Option<string?>("--status", "Filter by status");
        var searchOption = new Option<string?>("--search", "Search by release name");
        command.AddOption(appOption);
        command.AddOption(environmentOption);
        command.AddOption(statusOption);
        command.AddOption(searchOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            string? applicationId = null;
            try
            {
                var prefs = cli.ContextStoreFactory().Load();
                var appFlag = context.ParseResult.GetValueForOption(appOption);
                if (!string.IsNullOrWhiteSpace(appFlag))
                    applicationId = appFlag.Trim();
                else if (!string.IsNullOrWhiteSpace(prefs.DefaultApplicationId))
                    applicationId = prefs.DefaultApplicationId.Trim();
            }
            catch (InvalidOperationException ex)
            {
                await cli.Output.WriteErrorAsync(ex.Message);
                context.ExitCode = 1;
                return;
            }

            var environment = context.ParseResult.GetValueForOption(environmentOption);
            var status = context.ParseResult.GetValueForOption(statusOption);
            var search = context.ParseResult.GetValueForOption(searchOption);

            await CommandOptions.RunApiAsync(context, cli, "Error listing releases", async () =>
            {
                var releases = await apiClient.ListReleasesAsync(
                    applicationId,
                    environment,
                    status,
                    search,
                    context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    releases,
                    TogglyJsonSerializerContext.Default.ListReleaseSummary,
                    FormatReleaseList);
            });
        });
        return command;
    }

    private static Command CreateGetCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("get", "Get a release by id");
        var idArgument = new Argument<string>("id", "Release id");
        command.AddArgument(idArgument);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            var id = context.ParseResult.GetValueForArgument(idArgument);
            await CommandOptions.RunApiAsync(context, cli, "Error getting release", async () =>
            {
                var release = await apiClient.GetReleaseAsync(id, context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    release,
                    TogglyJsonSerializerContext.Default.ReleaseModel,
                    r => FormatRelease(r));
            });
        });
        return command;
    }

    private static Command CreateCreateCommand(
        string name,
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command(name, description);

        var applicationIdOption = CommandOptions.CreateAppOption();
        var nameOption = new Option<string>("--name", "Release name") { IsRequired = true };
        var releaseNotesOption = new Option<string?>("--release-notes", "Release notes");
        var featureChangesOption = new Option<string?>(
            "--feature-changes",
            "JSON array of feature changes. Format: [{\"flagKey\":\"key\",\"toState\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]");

        command.AddOption(applicationIdOption);
        command.AddOption(nameOption);
        command.AddOption(releaseNotesOption);
        command.AddOption(featureChangesOption);

        var options = new CreateReleaseOptionsBag(
            applicationIdOption,
            nameOption,
            releaseNotesOption,
            featureChangesOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleCreateReleaseAsync(context, apiClient, cli, options);
        });

        return command;
    }

    private static Command CreateAssociateBuildCommand(
        string name,
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command(name, description);

        var projectKeyOption = new Option<string>("--project-key", "Application ID or name") { IsRequired = true };
        var environmentOption = CommandOptions.CreateEnvOption(
            "Environment name (e.g., Production, Staging)");
        var ciProviderOption = new Option<string>(
            "--ci-provider",
            "CI provider (e.g., azure-devops, github, gitlab, jenkins, circleci)")
        {
            IsRequired = true
        };
        var runIdOption = new Option<string>("--run-id", "CI run/build ID") { IsRequired = true };
        var runUrlOption = new Option<string?>("--run-url", "URL to view the build in CI system");
        var pipelineNameOption = new Option<string>("--pipeline-name", "Name of the pipeline/workflow")
        {
            IsRequired = true
        };
        var branchOption = new Option<string?>("--branch", "Git branch name");
        var commitShaOption = new Option<string?>("--commit-sha", "Git commit SHA");
        var buildNumberOption = new Option<string?>("--build-number", "Build number/version");
        var modeOption = new Option<string>(
            "--mode",
            getDefaultValue: () => "use-latest-draft-or-create",
            description: "Mode for finding/creating release");
        var releaseTemplateKeyOption = new Option<string?>(
            "--release-template-key",
            "Release template key to use when creating new release");
        var namePatternOption = new Option<string?>(
            "--name-pattern",
            "Name pattern for release (Handlebars-style: ${branch}, ${buildNumber}, ${commitSha})");

        command.AddOption(projectKeyOption);
        command.AddOption(environmentOption);
        command.AddOption(ciProviderOption);
        command.AddOption(runIdOption);
        command.AddOption(runUrlOption);
        command.AddOption(pipelineNameOption);
        command.AddOption(branchOption);
        command.AddOption(commitShaOption);
        command.AddOption(buildNumberOption);
        command.AddOption(modeOption);
        command.AddOption(releaseTemplateKeyOption);
        command.AddOption(namePatternOption);

        var options = new AssociateBuildOptions(
            projectKeyOption,
            environmentOption,
            ciProviderOption,
            runIdOption,
            runUrlOption,
            pipelineNameOption,
            branchOption,
            commitShaOption,
            buildNumberOption,
            modeOption,
            releaseTemplateKeyOption,
            namePatternOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleAssociateBuildAsync(context, apiClient, cli, options);
        });

        return command;
    }

    private static async Task HandleCreateReleaseAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        CreateReleaseOptionsBag options)
    {
        if (!CommandOptions.TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        var name = context.ParseResult.GetValueForOption(options.Name)!;
        var releaseNotes = context.ParseResult.GetValueForOption(options.ReleaseNotes);
        var featureChanges = context.ParseResult.GetValueForOption(options.FeatureChanges);

        var request = new CreateReleaseRequest
        {
            ApplicationId = applicationId,
            Name = name,
            ReleaseNotes = releaseNotes
        };

        if (!TryApplyFeatureChanges(featureChanges, request, out var parseError))
        {
            await cli.Output.WriteErrorAsync(parseError);
            context.ExitCode = 2;
            return;
        }

        await CommandOptions.RunApiAsync(context, cli, "Error creating release", async () =>
        {
            var release = await apiClient.CreateReleaseAsync(request);
            await cli.Output.WriteAsync(
                context,
                release,
                TogglyJsonSerializerContext.Default.ReleaseModel,
                r => FormatRelease(r, "Release created"));
        });
    }

    private static async Task HandleAssociateBuildAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        AssociateBuildOptions options)
    {
        var projectKey = context.ParseResult.GetValueForOption(options.ProjectKey)!;
        if (!CommandOptions.TryResolveEnv(context, cli, options.Environment, out var environment))
            return;

        var ciProvider = context.ParseResult.GetValueForOption(options.CiProvider)!;
        var runId = context.ParseResult.GetValueForOption(options.RunId)!;
        var runUrl = context.ParseResult.GetValueForOption(options.RunUrl);
        var pipelineName = context.ParseResult.GetValueForOption(options.PipelineName)!;
        var branch = context.ParseResult.GetValueForOption(options.Branch);
        var commitSha = context.ParseResult.GetValueForOption(options.CommitSha);
        var buildNumber = context.ParseResult.GetValueForOption(options.BuildNumber);
        var mode = context.ParseResult.GetValueForOption(options.Mode)!;
        var releaseTemplateKey = context.ParseResult.GetValueForOption(options.ReleaseTemplateKey);
        var namePattern = context.ParseResult.GetValueForOption(options.NamePattern);

        var request = new AssociateBuildRequest
        {
            ProjectKey = projectKey,
            Environment = environment,
            CiProvider = ciProvider,
            Build = new BuildInfo
            {
                RunId = runId,
                RunUrl = runUrl,
                PipelineName = pipelineName,
                Branch = branch,
                CommitSha = commitSha,
                BuildNumber = buildNumber
            },
            Mode = mode,
            ReleaseTemplateKey = releaseTemplateKey
        };

        if (!string.IsNullOrEmpty(namePattern))
        {
            request.CreateOptions = new CreateReleaseOptions
            {
                NamePattern = namePattern
            };
        }

        await CommandOptions.RunApiAsync(context, cli, "Error associating build", async () =>
        {
            var response = await apiClient.AssociateBuildAsync(request);
            await cli.Output.WriteAsync(
                context,
                response,
                TogglyJsonSerializerContext.Default.AssociateBuildResponse,
                r =>
                {
                    var lines = new List<string> { $"Build associated with release: {r.ReleaseId}" };
                    if (!string.IsNullOrEmpty(r.ReleaseUrl))
                        lines.Add($"Release URL: {r.ReleaseUrl}");
                    return lines;
                });
        });
    }

    private static bool TryApplyFeatureChanges(
        string? featureChanges,
        CreateReleaseRequest request,
        out string errorMessage)
    {
        errorMessage = string.Empty;
        if (string.IsNullOrEmpty(featureChanges))
            return true;

        try
        {
            request.FeatureChanges = JsonSerializer.Deserialize(
                featureChanges,
                TogglyJsonSerializerContext.Default.ListFeatureChangeRequest)
                ?? [];
            return true;
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing feature changes: {ex.Message}";
            return false;
        }
    }

    private static IEnumerable<string> FormatReleaseList(List<ReleaseSummary> releases)
    {
        if (releases.Count == 0)
        {
            yield return "No releases found.";
            yield break;
        }

        foreach (var release in releases)
            yield return $"{release.Id}\t{release.Name}\t{release.OverallStatus ?? "-"}\tapp={release.ApplicationId}";
    }

    private static IEnumerable<string> FormatRelease(ReleaseModel release, string? verb = null)
    {
        if (!string.IsNullOrEmpty(verb))
            yield return $"{verb}: {release.Id}";
        else
            yield return release.Id;

        yield return $"  Name: {release.Name}";
        yield return $"  Application: {release.ApplicationId}";
        if (!string.IsNullOrEmpty(release.OverallStatus))
            yield return $"  Status: {release.OverallStatus}";
        if (!string.IsNullOrEmpty(release.ReleaseNotes))
            yield return $"  Notes: {release.ReleaseNotes}";
    }
}
