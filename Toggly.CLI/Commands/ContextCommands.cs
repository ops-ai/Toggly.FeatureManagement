using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// <c>toggly context set|get|clear</c> — non-secret default app/env preferences.
/// </summary>
public static class ContextCommands
{
    public static Command Create(CliCommandContext cli)
    {
        var context = new Command("context", "Manage non-secret default application and environment prefs");
        context.AddCommand(CreateSetCommand(cli));
        context.AddCommand(CreateGetCommand(cli));
        context.AddCommand(CreateClearCommand(cli));
        return context;
    }

    private static Command CreateSetCommand(CliCommandContext cli)
    {
        var command = new Command("set", "Set default application and/or environment");
        var appOption = new Option<string?>(["--app", "--application-id"], "Default application id");
        var envOption = new Option<string?>(["--env", "--environment"], "Default environment name");
        command.AddOption(appOption);
        command.AddOption(envOption);

        command.SetHandler(async (InvocationContext invocation) =>
        {
            var app = invocation.ParseResult.GetValueForOption(appOption);
            var env = invocation.ParseResult.GetValueForOption(envOption);
            if (string.IsNullOrWhiteSpace(app) && string.IsNullOrWhiteSpace(env))
            {
                await cli.Output.WriteErrorAsync("Specify --app and/or --env.");
                invocation.ExitCode = 2;
                return;
            }

            var store = cli.ContextStoreFactory();
            var prefs = store.Load();
            if (!string.IsNullOrWhiteSpace(app))
                prefs.DefaultApplicationId = app.Trim();
            if (!string.IsNullOrWhiteSpace(env))
                prefs.DefaultEnvironment = env.Trim();
            store.Save(prefs);

            await cli.Output.WriteAsync(
                invocation,
                prefs,
                TogglyJsonSerializerContext.Default.ContextPrefs,
                FormatPrefs);
        });
        return command;
    }

    private static Command CreateGetCommand(CliCommandContext cli)
    {
        var command = new Command("get", "Show current context preferences");
        command.SetHandler(async (InvocationContext invocation) =>
        {
            var prefs = cli.ContextStoreFactory().Load();
            await cli.Output.WriteAsync(
                invocation,
                prefs,
                TogglyJsonSerializerContext.Default.ContextPrefs,
                FormatPrefs);
        });
        return command;
    }

    private static Command CreateClearCommand(CliCommandContext cli)
    {
        var command = new Command("clear", "Clear context preferences");
        command.SetHandler(async (InvocationContext invocation) =>
        {
            cli.ContextStoreFactory().Clear();
            if (cli.Output.IsJson(invocation))
            {
                await cli.Output.WriteAsync(
                    invocation,
                    new ContextPrefs(),
                    TogglyJsonSerializerContext.Default.ContextPrefs,
                    _ => ["Context cleared."]);
            }
            else
            {
                await cli.Output.WriteLinesAsync(["Context cleared."]);
            }
        });
        return command;
    }

    private static IEnumerable<string> FormatPrefs(ContextPrefs prefs)
    {
        yield return $"Default application: {prefs.DefaultApplicationId ?? "(not set)"}";
        yield return $"Default environment: {prefs.DefaultEnvironment ?? "(not set)"}";
    }
}
