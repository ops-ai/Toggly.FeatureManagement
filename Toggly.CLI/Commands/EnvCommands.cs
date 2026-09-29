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
        env.AddCommand(CreateListCommand(apiClientFactory, cli));
        env.AddCommand(CreateGetCommand(apiClientFactory, cli));
        return env;
    }

    private static Command CreateListCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("list", "List environments for an application");
        var appOption = CommandOptions.CreateAppOption();
        command.AddOption(appOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            if (!CommandOptions.TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            await CommandOptions.RunApiAsync(context, cli, "Error listing environments", async () =>
            {
                var environments = await apiClient.ListEnvironmentsAsync(
                    applicationId,
                    context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    environments,
                    TogglyJsonSerializerContext.Default.ListEnvironmentSummary,
                    FormatEnvironmentList);
            });
        });
        return command;
    }

    private static Command CreateGetCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("get", "Get an environment by name");
        var appOption = CommandOptions.CreateAppOption();
        var nameArgument = new Argument<string>("name", "Environment name");
        command.AddOption(appOption);
        command.AddArgument(nameArgument);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            if (!CommandOptions.TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            var name = context.ParseResult.GetValueForArgument(nameArgument);
            await CommandOptions.RunApiAsync(context, cli, "Error getting environment", async () =>
            {
                var environment = await apiClient.GetEnvironmentAsync(
                    applicationId,
                    name,
                    context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    environment,
                    TogglyJsonSerializerContext.Default.EnvironmentSummary,
                    FormatEnvironment);
            });
        });
        return command;
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
