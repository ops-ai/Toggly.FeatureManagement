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
        app.AddCommand(CommandOptions.CreateGetByIdCommand(
            "Get an application by id",
            "Application id",
            apiClientFactory,
            cli,
            "Error getting application",
            async (apiClient, id, context, commandContext) =>
            {
                var result = await apiClient.GetApplicationAsync(id, context.GetCancellationToken());
                await CommandOptions.WriteResultAsync(
                    context,
                    commandContext,
                    result,
                    TogglyJsonSerializerContext.Default.ApplicationSummary,
                    FormatApplication);
            }));
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
                await CommandOptions.WriteResultAsync(
                    context,
                    cli,
                    apps,
                    TogglyJsonSerializerContext.Default.ListApplicationSummary,
                    FormatApplicationList);
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
