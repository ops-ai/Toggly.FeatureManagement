using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json.Serialization.Metadata;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// Shared option bags, resolution, and list/get scaffolding for noun commands.
/// </summary>
internal static class CommandOptions
{
    public static Option<string?> CreateAppOption() =>
        new(["--app", "--application-id"], "Application id (or set via 'toggly context set --app')");

    public static Option<string?> CreateEnvOption(string description) =>
        new(["--environment", "--env"], description);

    public static bool TryResolveApp(
        InvocationContext context,
        CliCommandContext cli,
        Option<string?> appOption,
        out string applicationId) =>
        TryResolve(context, cli, appOption, ContextStore.TryResolveApplicationId, out applicationId);

    public static bool TryResolveEnv(
        InvocationContext context,
        CliCommandContext cli,
        Option<string?> envOption,
        out string environment) =>
        TryResolve(context, cli, envOption, ContextStore.TryResolveEnvironment, out environment);

    public static async Task RunApiAsync(
        InvocationContext context,
        CliCommandContext cli,
        string errorPrefix,
        Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            await cli.Output.WriteErrorAsync($"{errorPrefix}: {ex.Message}");
            context.ExitCode = 1;
        }
    }

    public static IEnumerable<string> FormatListOrEmpty<T>(
        IReadOnlyList<T> items,
        string emptyMessage,
        Func<T, IEnumerable<string>> formatItem)
    {
        if (items.Count == 0)
        {
            yield return emptyMessage;
            yield break;
        }

        foreach (var item in items)
        {
            foreach (var line in formatItem(item))
                yield return line;
            yield return string.Empty;
        }
    }

    /// <summary>
    /// <c>get &lt;id&gt;</c> without an application scope (apps, releases).
    /// </summary>
    public static Command CreateGetByIdCommand(
        string description,
        string argumentDescription,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli,
        string errorPrefix,
        Func<TogglyApiClient, string, InvocationContext, CliCommandContext, Task> onGet)
    {
        var command = new Command("get", description);
        var idArgument = new Argument<string>("id", argumentDescription);
        command.AddArgument(idArgument);

        command.SetHandler(async (InvocationContext context) =>
        {
            if (!TryGetClient(apiClientFactory, context, out var apiClient))
                return;

            var id = context.ParseResult.GetValueForArgument(idArgument);
            await RunApiAsync(context, cli, errorPrefix, () => onGet(apiClient, id, context, cli));
        });
        return command;
    }

    /// <summary>
    /// <c>list --app</c> requiring application id (envs, features).
    /// </summary>
    public static Command CreateAppScopedListCommand(
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli,
        string errorPrefix,
        Func<TogglyApiClient, string, InvocationContext, CliCommandContext, Task> onList)
    {
        var command = new Command("list", description);
        var appOption = CreateAppOption();
        command.AddOption(appOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            if (!TryGetClient(apiClientFactory, context, out var apiClient))
                return;

            if (!TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            await RunApiAsync(context, cli, errorPrefix, () => onList(apiClient, applicationId, context, cli));
        });
        return command;
    }

    /// <summary>
    /// <c>get --app &lt;name|key&gt;</c> requiring application id (envs, features).
    /// </summary>
    public static Command CreateAppScopedGetCommand(
        string description,
        string argumentName,
        string argumentDescription,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli,
        string errorPrefix,
        Func<TogglyApiClient, string, string, InvocationContext, CliCommandContext, Task> onGet)
    {
        var command = new Command("get", description);
        var appOption = CreateAppOption();
        var argument = new Argument<string>(argumentName, argumentDescription);
        command.AddOption(appOption);
        command.AddArgument(argument);

        command.SetHandler(async (InvocationContext context) =>
        {
            if (!TryGetClient(apiClientFactory, context, out var apiClient))
                return;

            if (!TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            var key = context.ParseResult.GetValueForArgument(argument);
            await RunApiAsync(context, cli, errorPrefix, () => onGet(apiClient, applicationId, key, context, cli));
        });
        return command;
    }

    public static Task WriteResultAsync<T>(
        InvocationContext context,
        CliCommandContext cli,
        T value,
        JsonTypeInfo<T> typeInfo,
        Func<T, IEnumerable<string>> humanLines) =>
        cli.Output.WriteAsync(context, value, typeInfo, humanLines);

    private static bool TryGetClient(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        InvocationContext context,
        out TogglyApiClient apiClient)
    {
        var client = apiClientFactory(context);
        if (client is null)
        {
            apiClient = null!;
            return false;
        }

        apiClient = client;
        return true;
    }

    private delegate bool ResolvePreference(
        string? flag,
        Models.ContextPrefs prefs,
        out string value,
        out string error);

    private static bool TryResolve(
        InvocationContext context,
        CliCommandContext cli,
        Option<string?> option,
        ResolvePreference resolve,
        out string value)
    {
        try
        {
            var prefs = cli.ContextStoreFactory().Load();
            var flag = context.ParseResult.GetValueForOption(option);
            if (resolve(flag, prefs, out value, out var error))
                return true;

            cli.Output.WriteErrorAsync(error).GetAwaiter().GetResult();
            context.ExitCode = 2;
            return false;
        }
        catch (InvalidOperationException ex)
        {
            cli.Output.WriteErrorAsync(ex.Message).GetAwaiter().GetResult();
            context.ExitCode = 1;
            value = string.Empty;
            return false;
        }
    }
}
