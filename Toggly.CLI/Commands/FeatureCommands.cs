using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// Feature noun commands and flat write aliases.
/// </summary>
public static class FeatureCommands
{
    private sealed record CreateFeatureOptions(
        Option<string?> ApplicationId,
        Option<string> Name,
        Option<string> FeatureKey,
        Option<string?> Description,
        Option<string?> Category,
        Option<string?> Tags,
        Option<string?> EnvironmentFilters);

    private sealed record UpdateFeatureOptions(
        Option<string?> ApplicationId,
        Option<string> FeatureKey,
        Option<string?> Name,
        Option<string?> Description,
        Option<string?> Category,
        Option<string?> Tags);

    private sealed record UpdateFeatureEnvironmentOptions(
        Option<string?> ApplicationId,
        Option<string?> Environment,
        Option<string> FeatureKey,
        Option<bool> Enable,
        Option<bool> Disable,
        Option<string?> Filters);

    /// <summary>
    /// Create the <c>feature</c> noun group.
    /// </summary>
    public static Command CreateNoun(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var feature = new Command("feature", "List, inspect, and manage features");
        feature.AddCommand(CreateListCommand(apiClientFactory, cli));
        feature.AddCommand(CreateGetCommand(apiClientFactory, cli));
        feature.AddCommand(CreateCreateCommand("create", "Create a new feature", apiClientFactory, cli));
        feature.AddCommand(CreateUpdateCommand("update", "Update an existing feature", apiClientFactory, cli));
        feature.AddCommand(CreateUpdateEnvironmentCommand(
            "update-environment",
            "Update feature configuration on a specific environment",
            apiClientFactory,
            cli));
        return feature;
    }

    /// <summary>Flat alias: <c>create-feature</c>.</summary>
    public static Command CreateFeatureAlias(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli) =>
        CreateCreateCommand("create-feature", "Create a new feature", apiClientFactory, cli);

    /// <summary>Flat alias: <c>update-feature</c>.</summary>
    public static Command CreateUpdateFeatureAlias(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli) =>
        CreateUpdateCommand("update-feature", "Update an existing feature", apiClientFactory, cli);

    /// <summary>Flat alias: <c>update-feature-environment</c>.</summary>
    public static Command CreateUpdateFeatureEnvironmentAlias(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli) =>
        CreateUpdateEnvironmentCommand(
            "update-feature-environment",
            "Update feature configuration on a specific environment",
            apiClientFactory,
            cli);

    private static Command CreateListCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("list", "List features for an application");
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
                var features = await apiClient.ListFeaturesAsync(applicationId, context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    features,
                    TogglyJsonSerializerContext.Default.ListFeatureDefinition,
                    FormatFeatureList);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await cli.Output.WriteErrorAsync($"Error listing features: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static Command CreateGetCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("get", "Get a feature by key");
        var appOption = CreateAppOption();
        var keyArgument = new Argument<string>("key", "Feature key");
        command.AddOption(appOption);
        command.AddArgument(keyArgument);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            if (!TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            var key = context.ParseResult.GetValueForArgument(keyArgument);
            try
            {
                var feature = await apiClient.GetFeatureAsync(
                    applicationId,
                    key,
                    context.GetCancellationToken());
                await cli.Output.WriteAsync(
                    context,
                    feature,
                    TogglyJsonSerializerContext.Default.FeatureDefinition,
                    f => FormatFeature(f));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await cli.Output.WriteErrorAsync($"Error getting feature: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static Command CreateCreateCommand(
        string name,
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command(name, description);

        var applicationIdOption = CreateAppOption();
        var nameOption = new Option<string>("--name", "Feature display name") { IsRequired = true };
        var featureKeyOption = new Option<string>("--feature-key", "Feature key (used as reference in application)")
        {
            IsRequired = true
        };
        var descriptionOption = new Option<string?>("--description", "Feature description");
        var categoryOption = new Option<string?>("--category", "Feature category");
        var tagsOption = new Option<string?>("--tags", "Comma-separated list of tags");
        var environmentFiltersOption = new Option<string?>(
            "--environment-filters",
            "JSON object mapping environment names to filter arrays. Format: {\"Production\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}");

        command.AddOption(applicationIdOption);
        command.AddOption(nameOption);
        command.AddOption(featureKeyOption);
        command.AddOption(descriptionOption);
        command.AddOption(categoryOption);
        command.AddOption(tagsOption);
        command.AddOption(environmentFiltersOption);

        var options = new CreateFeatureOptions(
            applicationIdOption,
            nameOption,
            featureKeyOption,
            descriptionOption,
            categoryOption,
            tagsOption,
            environmentFiltersOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleCreateFeatureAsync(context, apiClient, cli, options);
        });

        return command;
    }

    private static Command CreateUpdateCommand(
        string name,
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command(name, description);

        var applicationIdOption = CreateAppOption();
        var featureKeyOption = new Option<string>("--feature-key", "Feature key to update") { IsRequired = true };
        var nameOption = new Option<string?>("--name", "Feature display name");
        var descriptionOption = new Option<string?>("--description", "Feature description");
        var categoryOption = new Option<string?>("--category", "Feature category");
        var tagsOption = new Option<string?>("--tags", "Comma-separated list of tags");

        command.AddOption(applicationIdOption);
        command.AddOption(featureKeyOption);
        command.AddOption(nameOption);
        command.AddOption(descriptionOption);
        command.AddOption(categoryOption);
        command.AddOption(tagsOption);

        var options = new UpdateFeatureOptions(
            applicationIdOption,
            featureKeyOption,
            nameOption,
            descriptionOption,
            categoryOption,
            tagsOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleUpdateFeatureAsync(context, apiClient, cli, options);
        });

        return command;
    }

    private static Command CreateUpdateEnvironmentCommand(
        string name,
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command(name, description);

        var applicationIdOption = CreateAppOption();
        var environmentOption = new Option<string?>(
            ["--environment", "--env"],
            "Environment name (e.g., Production, Staging)");
        var featureKeyOption = new Option<string>("--feature-key", "Feature key") { IsRequired = true };
        var enableOption = new Option<bool>("--enable", "Enable the feature (sets AlwaysOn filter)");
        var disableOption = new Option<bool>("--disable", "Disable the feature (removes all filters)");
        var filtersOption = new Option<string?>(
            "--filters",
            "JSON array of filter objects. Format: [{\"name\":\"FilterName\",\"parameters\":{\"Key\":\"Value\"}}]");

        command.AddOption(applicationIdOption);
        command.AddOption(environmentOption);
        command.AddOption(featureKeyOption);
        command.AddOption(enableOption);
        command.AddOption(disableOption);
        command.AddOption(filtersOption);

        var options = new UpdateFeatureEnvironmentOptions(
            applicationIdOption,
            environmentOption,
            featureKeyOption,
            enableOption,
            disableOption,
            filtersOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleUpdateFeatureEnvironmentAsync(context, apiClient, cli, options);
        });

        return command;
    }

    private static async Task HandleCreateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        CreateFeatureOptions options)
    {
        if (!TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        var name = context.ParseResult.GetValueForOption(options.Name)!;
        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var description = context.ParseResult.GetValueForOption(options.Description);
        var category = context.ParseResult.GetValueForOption(options.Category);
        var tags = context.ParseResult.GetValueForOption(options.Tags);
        var environmentFilters = context.ParseResult.GetValueForOption(options.EnvironmentFilters);

        var model = new FeatureDefinitionCreateModel
        {
            Name = name,
            FeatureKey = featureKey,
            Description = description,
            Category = category
        };

        if (!string.IsNullOrEmpty(tags))
            model.Tags = tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        if (!TryApplyEnvironmentFilters(environmentFilters, model, out var parseError))
        {
            await cli.Output.WriteErrorAsync(parseError);
            context.ExitCode = 2;
            return;
        }

        try
        {
            var feature = await apiClient.CreateFeatureAsync(applicationId, model);
            await cli.Output.WriteAsync(
                context,
                feature,
                TogglyJsonSerializerContext.Default.FeatureDefinition,
                f => FormatFeature(f, "Feature created"));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            await cli.Output.WriteErrorAsync($"Error creating feature: {ex.Message}");
            context.ExitCode = 1;
        }
    }

    private static async Task HandleUpdateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        UpdateFeatureOptions options)
    {
        if (!TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var name = context.ParseResult.GetValueForOption(options.Name);
        var description = context.ParseResult.GetValueForOption(options.Description);
        var category = context.ParseResult.GetValueForOption(options.Category);
        var tags = context.ParseResult.GetValueForOption(options.Tags);

        var model = new FeatureDefinition
        {
            FeatureKey = featureKey,
            Name = name ?? featureKey,
            Description = description,
            Category = category
        };

        if (!string.IsNullOrEmpty(tags))
            model.Tags = tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        try
        {
            var feature = await apiClient.UpdateFeatureAsync(applicationId, featureKey, model);
            await cli.Output.WriteAsync(
                context,
                feature,
                TogglyJsonSerializerContext.Default.FeatureDefinition,
                f => FormatFeature(f, "Feature updated"));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            await cli.Output.WriteErrorAsync($"Error updating feature: {ex.Message}");
            context.ExitCode = 1;
        }
    }

    private static async Task HandleUpdateFeatureEnvironmentAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        UpdateFeatureEnvironmentOptions options)
    {
        if (!TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        var prefs = cli.ContextStoreFactory().Load();
        var environmentFlag = context.ParseResult.GetValueForOption(options.Environment);
        if (!ContextStore.TryResolveEnvironment(environmentFlag, prefs, out var environment, out var envError))
        {
            await cli.Output.WriteErrorAsync(envError);
            context.ExitCode = 2;
            return;
        }

        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var enable = context.ParseResult.GetValueForOption(options.Enable);
        var disable = context.ParseResult.GetValueForOption(options.Disable);
        var filters = context.ParseResult.GetValueForOption(options.Filters);

        if (!TryResolveFilterList(enable, disable, filters, out var filterList, out var errorMessage))
        {
            await cli.Output.WriteErrorAsync(errorMessage);
            context.ExitCode = 2;
            return;
        }

        try
        {
            var updatedFilters = await apiClient.UpdateFeatureEnvironmentAsync(
                applicationId,
                environment,
                featureKey,
                filterList);

            if (cli.Output.IsJson(context))
            {
                await cli.Output.WriteAsync(
                    context,
                    updatedFilters,
                    TogglyJsonSerializerContext.Default.ListFeatureFilter,
                    _ => []);
            }
            else
            {
                await cli.Output.WriteLinesAsync([
                    $"Feature '{featureKey}' updated in environment '{environment}'",
                    $"Filters: {updatedFilters.Count}",
                    .. updatedFilters.Select(filter => $"  - {filter.Name}")
                ]);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            await cli.Output.WriteErrorAsync($"Error updating feature environment: {ex.Message}");
            context.ExitCode = 1;
        }
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

    private static bool TryApplyEnvironmentFilters(
        string? environmentFilters,
        FeatureDefinitionCreateModel model,
        out string errorMessage)
    {
        errorMessage = string.Empty;
        if (string.IsNullOrEmpty(environmentFilters))
            return true;

        try
        {
            model.EnvironmentFilters = JsonSerializer.Deserialize(
                environmentFilters,
                TogglyJsonSerializerContext.Default.DictionaryStringListFeatureFilter);
            return true;
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing environment filters: {ex.Message}";
            return false;
        }
    }

    private static bool TryResolveFilterList(
        bool enable,
        bool disable,
        string? filters,
        out List<FeatureFilter> filterList,
        out string errorMessage)
    {
        filterList = [];
        errorMessage = string.Empty;

        if (enable && disable)
        {
            errorMessage = "Cannot specify both --enable and --disable";
            return false;
        }

        if (enable)
        {
            filterList =
            [
                new FeatureFilter
                {
                    Name = "AlwaysOn",
                    Parameters = new Dictionary<string, object>()
                }
            ];
            return true;
        }

        if (disable)
            return true;

        if (string.IsNullOrEmpty(filters))
        {
            errorMessage = "Must specify one of: --enable, --disable, or --filters";
            return false;
        }

        try
        {
            filterList = JsonSerializer.Deserialize(filters, TogglyJsonSerializerContext.Default.ListFeatureFilter)
                ?? [];
            return true;
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing filters: {ex.Message}";
            return false;
        }
    }

    private static IEnumerable<string> FormatFeatureList(List<FeatureDefinition> features)
    {
        if (features.Count == 0)
        {
            yield return "No features found.";
            yield break;
        }

        foreach (var feature in features)
        {
            foreach (var line in FormatFeature(feature))
                yield return line;
            yield return string.Empty;
        }
    }

    private static IEnumerable<string> FormatFeature(FeatureDefinition feature, string? verb = null)
    {
        if (!string.IsNullOrEmpty(verb))
            yield return $"{verb}: {feature.FeatureKey}";
        else
            yield return feature.FeatureKey;

        yield return $"  Name: {feature.Name}";
        if (!string.IsNullOrEmpty(feature.Description))
            yield return $"  Description: {feature.Description}";
        if (!string.IsNullOrEmpty(feature.Category))
            yield return $"  Category: {feature.Category}";
    }
}
