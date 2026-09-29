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
        var appOption = CreateAppOption();
        command.AddOption(appOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            if (!TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            try
            {
                var environments = await apiClient.ListEnvironmentsAsync(
                    applicationId,
                    context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    environments,
                    TogglyJsonSerializerContext.Default.ListEnvironmentSummary,
                    FormatEnvironmentList);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await cli.Output.WriteErrorAsync($"Error listing environments: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static Command CreateGetCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("get", "Get an environment by name");
        var appOption = CreateAppOption();
        var nameArgument = new Argument<string>("name", "Environment name");
        command.AddOption(appOption);
        command.AddArgument(nameArgument);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            if (!TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            var name = context.ParseResult.GetValueForArgument(nameArgument);
            try
            {
                var environment = await apiClient.GetEnvironmentAsync(
                    applicationId,
                    name,
                    context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    environment,
                    TogglyJsonSerializerContext.Default.EnvironmentSummary,
                    e => FormatEnvironment(e));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await cli.Output.WriteErrorAsync($"Error getting environment: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static Option<string?> CreateAppOption() =>
        new(["--app", "--application-id"], "Application id (or set via 'toggly context set --app')");

    private static bool TryResolveApp(
        InvocationContext context,
        CliCommandContext cli,
        Option<string?> appOption,
        out string applicationId)
    {
        var prefs = cli.ContextStoreFactory().Load();
        var flag = context.ParseResult.GetValueForOption(appOption);
        if (ContextStore.TryResolveApplicationId(flag, prefs, out applicationId, out var error))
            return true;

        cli.Output.WriteErrorAsync(error).GetAwaiter().GetResult();
        context.ExitCode = 2;
        return false;
    }

    private static IEnumerable<string> FormatEnvironmentList(List<EnvironmentSummary> environments)
    {
        if (environments.Count == 0)
        {
            yield return "No environments found.";
            yield break;
        }

        foreach (var environment in environments)
        {
            foreach (var line in FormatEnvironment(environment))
                yield return line;
            yield return string.Empty;
        }
    }

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
