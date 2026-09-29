using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// Shared option bags and resolution helpers for noun commands.
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
        out string applicationId)
    {
        try
        {
            var prefs = cli.ContextStoreFactory().Load();
            var flag = context.ParseResult.GetValueForOption(appOption);
            if (ContextStore.TryResolveApplicationId(flag, prefs, out applicationId, out var error))
                return true;

            cli.Output.WriteErrorAsync(error).GetAwaiter().GetResult();
            context.ExitCode = 2;
            return false;
        }
        catch (InvalidOperationException ex)
        {
            cli.Output.WriteErrorAsync(ex.Message).GetAwaiter().GetResult();
            context.ExitCode = 1;
            applicationId = string.Empty;
            return false;
        }
    }

    public static bool TryResolveEnv(
        InvocationContext context,
        CliCommandContext cli,
        Option<string?> envOption,
        out string environment)
    {
        try
        {
            var prefs = cli.ContextStoreFactory().Load();
            var flag = context.ParseResult.GetValueForOption(envOption);
            if (ContextStore.TryResolveEnvironment(flag, prefs, out environment, out var error))
                return true;

            cli.Output.WriteErrorAsync(error).GetAwaiter().GetResult();
            context.ExitCode = 2;
            return false;
        }
        catch (InvalidOperationException ex)
        {
            cli.Output.WriteErrorAsync(ex.Message).GetAwaiter().GetResult();
            context.ExitCode = 1;
            environment = string.Empty;
            return false;
        }
    }

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
}
