using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Toggly.CLI;

namespace Toggly.CLI.Commands;

/// <summary>
/// Release-related commands
/// </summary>
public static class ReleaseCommands
{
    private sealed record CreateReleaseOptionsBag(
        Option<string> ApplicationId,
        Option<string> Name,
        Option<string?> ReleaseNotes,
        Option<string?> FeatureChanges);

    private sealed record AssociateBuildOptions(
        Option<string> ProjectKey,
        Option<string> Environment,
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
    /// Create the release command group
    /// </summary>
    public static Command CreateReleaseCommand(Func<InvocationContext, TogglyApiClient?> apiClientFactory)
    {
        var command = new Command("create-release", "Create a new release");

        var applicationIdOption = new Option<string>(
            "--application-id",
            description: "Application ID")
        {
            IsRequired = true
        };

        var nameOption = new Option<string>(
            "--name",
            description: "Release name")
        {
            IsRequired = true
        };

        var releaseNotesOption = new Option<string?>(
            "--release-notes",
            description: "Release notes");

        var featureChangesOption = new Option<string?>(
            "--feature-changes",
            description: "JSON array of feature changes. Format: [{\"flagKey\":\"key\",\"toState\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}]");

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

            await HandleCreateReleaseAsync(context, apiClient, options);
        });

        return command;
    }

    /// <summary>
    /// Create the associate-build command
    /// </summary>
    public static Command CreateAssociateBuildCommand(Func<InvocationContext, TogglyApiClient?> apiClientFactory)
    {
        var command = new Command("associate-build", "Associate a CI build with a release");

        var projectKeyOption = new Option<string>(
            "--project-key",
            description: "Application ID or name")
        {
            IsRequired = true
        };

        var environmentOption = new Option<string>(
            "--environment",
            description: "Environment name (e.g., Production, Staging)")
        {
            IsRequired = true
        };

        var ciProviderOption = new Option<string>(
            "--ci-provider",
            description: "CI provider (e.g., azure-devops, github, gitlab, jenkins, circleci)")
        {
            IsRequired = true
        };

        var runIdOption = new Option<string>(
            "--run-id",
            description: "CI run/build ID")
        {
            IsRequired = true
        };

        var runUrlOption = new Option<string?>(
            "--run-url",
            description: "URL to view the build in CI system");

        var pipelineNameOption = new Option<string>(
            "--pipeline-name",
            description: "Name of the pipeline/workflow")
        {
            IsRequired = true
        };

        var branchOption = new Option<string?>(
            "--branch",
            description: "Git branch name");

        var commitShaOption = new Option<string?>(
            "--commit-sha",
            description: "Git commit SHA");

        var buildNumberOption = new Option<string?>(
            "--build-number",
            description: "Build number/version");

        var modeOption = new Option<string>(
            "--mode",
            getDefaultValue: () => "use-latest-draft-or-create",
            description: "Mode for finding/creating release");

        var releaseTemplateKeyOption = new Option<string?>(
            "--release-template-key",
            description: "Release template key to use when creating new release");

        var namePatternOption = new Option<string?>(
            "--name-pattern",
            description: "Name pattern for release (Handlebars-style: ${branch}, ${buildNumber}, ${commitSha})");

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

            await HandleAssociateBuildAsync(context, apiClient, options);
        });

        return command;
    }

    private static async Task HandleCreateReleaseAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CreateReleaseOptionsBag options)
    {
        var applicationId = context.ParseResult.GetValueForOption(options.ApplicationId)!;
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
            await Console.Error.WriteLineAsync(parseError);
            context.ExitCode = 2;
            return;
        }

        try
        {
            var release = await apiClient.CreateReleaseAsync(request);
            await Console.Out.WriteLineAsync($"Release created: {release.Id}");
            await Console.Out.WriteLineAsync($"Name: {release.Name}");
            if (!string.IsNullOrEmpty(release.ReleaseNotes))
                await Console.Out.WriteLineAsync($"Notes: {release.ReleaseNotes}");
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"Error creating release: {ex.Message}");
            context.ExitCode = 1;
        }
    }

    private static async Task HandleAssociateBuildAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        AssociateBuildOptions options)
    {
        var projectKey = context.ParseResult.GetValueForOption(options.ProjectKey)!;
        var environment = context.ParseResult.GetValueForOption(options.Environment)!;
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

        try
        {
            var response = await apiClient.AssociateBuildAsync(request);
            await Console.Out.WriteLineAsync($"Build associated with release: {response.ReleaseId}");
            if (!string.IsNullOrEmpty(response.ReleaseUrl))
                await Console.Out.WriteLineAsync($"Release URL: {response.ReleaseUrl}");
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"Error associating build: {ex.Message}");
            context.ExitCode = 1;
        }
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
}
