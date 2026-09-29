using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// <c>toggly app list|get</c> commands.
/// </summary>
public static class AppCommands
{
    public static Command Create(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var app = new Command("app", "List and inspect applications");
        app.AddCommand(CreateListCommand(apiClientFactory, cli));
        app.AddCommand(CreateGetCommand(apiClientFactory, cli));
        return app;
    }

    private static Command CreateListCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("list", "List applications");
        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            try
            {
                var apps = await apiClient.ListApplicationsAsync(context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    apps,
                    TogglyJsonSerializerContext.Default.ListApplicationSummary,
                    FormatApplicationList);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await cli.Output.WriteErrorAsync($"Error listing applications: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static Command CreateGetCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("get", "Get an application by id");
        var idArgument = new Argument<string>("id", "Application id");
        command.AddArgument(idArgument);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            var id = context.ParseResult.GetValueForArgument(idArgument);
            try
            {
                var app = await apiClient.GetApplicationAsync(id, context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    app,
                    TogglyJsonSerializerContext.Default.ApplicationSummary,
                    a => FormatApplication(a));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await cli.Output.WriteErrorAsync($"Error getting application: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static IEnumerable<string> FormatApplicationList(List<ApplicationSummary> apps)
    {
        if (apps.Count == 0)
        {
            yield return "No applications found.";
            yield break;
        }

        foreach (var app in apps)
        {
            foreach (var line in FormatApplication(app))
                yield return line;
            yield return string.Empty;
        }
    }

    private static IEnumerable<string> FormatApplication(ApplicationSummary app)
    {
        yield return $"{app.Id}\t{app.Name}";
        if (!string.IsNullOrEmpty(app.Description))
            yield return $"  Description: {app.Description}";
        if (app.Environments is { Count: > 0 })
            yield return $"  Environments: {string.Join(", ", app.Environments)}";
        if (!string.IsNullOrEmpty(app.DefaultEnvironment))
            yield return $"  Default environment: {app.DefaultEnvironment}";
        if (app.DefinitionsCount > 0)
            yield return $"  Features: {app.DefinitionsCount}";
    }
}
