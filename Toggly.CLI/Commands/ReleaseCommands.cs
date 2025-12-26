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
    /// <summary>
    /// Create the release command group
    /// </summary>
    public static Command CreateReleaseCommand(Func<InvocationContext, TogglyApiClient> apiClientFactory)
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

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            var applicationId = context.ParseResult.GetValueForOption(applicationIdOption)!;
            var name = context.ParseResult.GetValueForOption(nameOption)!;
            var releaseNotes = context.ParseResult.GetValueForOption(releaseNotesOption);
            var featureChanges = context.ParseResult.GetValueForOption(featureChangesOption);

            var request = new CreateReleaseRequest
            {
                ApplicationId = applicationId,
                Name = name,
                ReleaseNotes = releaseNotes
            };

            if (!string.IsNullOrEmpty(featureChanges))
            {
                try
                {
                    request.FeatureChanges = JsonSerializer.Deserialize(featureChanges, TogglyJsonSerializerContext.Default.ListFeatureChangeRequest)
                        ?? new List<FeatureChangeRequest>();
                }
                catch (JsonException ex)
                {
                    Console.Error.WriteLine($"Error parsing feature changes: {ex.Message}");
                    context.ExitCode = 2;
                    return;
                }
            }

            try
            {
                var release = await apiClient.CreateReleaseAsync(request);
                Console.WriteLine($"Release created: {release.Id}");
                Console.WriteLine($"Name: {release.Name}");
                if (!string.IsNullOrEmpty(release.ReleaseNotes))
                    Console.WriteLine($"Notes: {release.ReleaseNotes}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error creating release: {ex.Message}");
                context.ExitCode = 1;
            }
        });

        return command;
    }

    /// <summary>
    /// Create the associate-build command
    /// </summary>
    public static Command CreateAssociateBuildCommand(Func<InvocationContext, TogglyApiClient> apiClientFactory)
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

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            var projectKey = context.ParseResult.GetValueForOption(projectKeyOption)!;
            var environment = context.ParseResult.GetValueForOption(environmentOption)!;
            var ciProvider = context.ParseResult.GetValueForOption(ciProviderOption)!;
            var runId = context.ParseResult.GetValueForOption(runIdOption)!;
            var runUrl = context.ParseResult.GetValueForOption(runUrlOption);
            var pipelineName = context.ParseResult.GetValueForOption(pipelineNameOption)!;
            var branch = context.ParseResult.GetValueForOption(branchOption);
            var commitSha = context.ParseResult.GetValueForOption(commitShaOption);
            var buildNumber = context.ParseResult.GetValueForOption(buildNumberOption);
            var mode = context.ParseResult.GetValueForOption(modeOption)!;
            var releaseTemplateKey = context.ParseResult.GetValueForOption(releaseTemplateKeyOption);
            var namePattern = context.ParseResult.GetValueForOption(namePatternOption);

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
                Console.WriteLine($"Build associated with release: {response.ReleaseId}");
                if (!string.IsNullOrEmpty(response.ReleaseUrl))
                    Console.WriteLine($"Release URL: {response.ReleaseUrl}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error associating build: {ex.Message}");
                context.ExitCode = 1;
            }
        });

        return command;
    }
}

