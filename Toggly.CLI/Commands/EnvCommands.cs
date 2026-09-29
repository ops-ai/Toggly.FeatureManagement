using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// <c>toggly env list|get</c> commands.
/// </summary>
public static class EnvCommands
{
    public static Command Create(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var env = new Command("env", "List and inspect application environments");
        env.AddCommand(CommandOptions.CreateAppScopedListCommand(
            "List environments for an application",
            apiClientFactory,
            cli,
            "Error listing environments",
            async (apiClient, applicationId, context, commandContext) =>
            {
                var environments = await apiClient.ListEnvironmentsAsync(
                    applicationId,
                    context.GetCancellationToken());
                await CommandOptions.WriteResultAsync(
                    context,
                    commandContext,
                    environments,
                    TogglyJsonSerializerContext.Default.ListEnvironmentSummary,
                    FormatEnvironmentList);
            }));
        env.AddCommand(CommandOptions.CreateAppScopedGetCommand(
            "Get an environment by name",
            "name",
            "Environment name",
            apiClientFactory,
            cli,
            "Error getting environment",
            async (apiClient, applicationId, name, context, commandContext) =>
            {
                var environment = await apiClient.GetEnvironmentAsync(
                    applicationId,
                    name,
                    context.GetCancellationToken());
                await CommandOptions.WriteResultAsync(
                    context,
                    commandContext,
                    environment,
                    TogglyJsonSerializerContext.Default.EnvironmentSummary,
                    FormatEnvironment);
            }));
        return env;
    }

    private static IEnumerable<string> FormatEnvironmentList(List<EnvironmentSummary> environments) =>
        CommandOptions.FormatListOrEmpty(environments, "No environments found.", FormatEnvironment);

    private static IEnumerable<string> FormatEnvironment(EnvironmentSummary environment)
    {
        yield return environment.Name;
        if (!string.IsNullOrEmpty(environment.Description))
            yield return $"  Description: {environment.Description}";
        if (!string.IsNullOrEmpty(environment.Type))
            yield return $"  Type: {environment.Type}";
        yield return $"  Active: {environment.IsActive}";
        yield return $"  Active features: {environment.ActiveFeatures}";
        if (environment.PromoteTo is { Count: > 0 })
            yield return $"  Promote to: {string.Join(", ", environment.PromoteTo)}";
    }
}
