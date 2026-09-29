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

            await CommandOptions.RunApiAsync(context, cli, "Error listing applications", async () =>
            {
                var apps = await apiClient.ListApplicationsAsync(context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    apps,
                    TogglyJsonSerializerContext.Default.ListApplicationSummary,
                    FormatApplicationList);
            });
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
            await CommandOptions.RunApiAsync(context, cli, "Error getting application", async () =>
            {
                var app = await apiClient.GetApplicationAsync(id, context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    app,
                    TogglyJsonSerializerContext.Default.ApplicationSummary,
                    FormatApplication);
            });
        });
        return command;
    }

    private static IEnumerable<string> FormatApplicationList(List<ApplicationSummary> apps) =>
        CommandOptions.FormatListOrEmpty(apps, "No applications found.", FormatApplication);

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
