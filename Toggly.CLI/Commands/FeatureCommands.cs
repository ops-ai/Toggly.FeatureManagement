using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Filters;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;
using Toggly.CLI.Variants;

namespace Toggly.CLI.Commands;

/// <summary>
/// Feature noun commands and flat write aliases.
/// </summary>
public static class FeatureCommands
{
    private sealed record FilterBuilderOptions(
        Option<bool> Enable,
        Option<double?> Percentage,
        Option<string?> TargetingUsers,
        Option<string?> TargetingGroups,
        Option<double?> TargetingDefaultRollout,
        Option<bool> TargetingIgnoreCase,
        Option<string?> TimeWindowStart,
        Option<string?> TimeWindowEnd);

    private sealed record CreateFeatureOptions(
        Option<string?> ApplicationId,
        Option<string> Name,
        Option<string> FeatureKey,
        Option<string?> Description,
        Option<string?> Category,
        Option<string?> Tags,
        Option<string?> EnvironmentFilters,
        Option<string?> Environment,
        FilterBuilderOptions FilterBuilder,
        Option<string?> Variants,
        Option<string?> Allocation);

    private sealed record UpdateFeatureOptions(
        Option<string?> ApplicationId,
        Option<string> FeatureKey,
        Option<string?> Name,
        Option<string?> Description,
        Option<string?> Category,
        Option<string?> Tags,
        Option<string?> Variants,
        Option<string?> Allocation,
        Option<string?> Filters,
        FilterBuilderOptions FilterBuilder);

    private sealed record UpdateFeatureEnvironmentOptions(
        Option<string?> ApplicationId,
        Option<string?> Environment,
        Option<string> FeatureKey,
        Option<bool> Disable,
        Option<string?> Filters,
        FilterBuilderOptions FilterBuilder);

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
        CliCommandContext cli) =>
        CommandOptions.CreateAppScopedListCommand(
            "List features for an application",
            apiClientFactory,
            cli,
            "Error listing features",
            async (apiClient, applicationId, context, commandContext) =>
            {
                var features = await apiClient.ListFeaturesAsync(applicationId, context.GetCancellationToken());
                await CommandOptions.WriteResultAsync(
                    context,
                    commandContext,
                    features,
                    TogglyJsonSerializerContext.Default.ListFeatureDefinition,
                    FormatFeatureList);
            });

    private static Command CreateGetCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli) =>
        CommandOptions.CreateAppScopedGetCommand(
            "Get a feature by key",
            "key",
            "Feature key",
            apiClientFactory,
            cli,
            "Error getting feature",
            async (apiClient, applicationId, key, context, commandContext) =>
            {
                var feature = await apiClient.GetFeatureAsync(
                    applicationId,
                    key,
                    context.GetCancellationToken());
                await CommandOptions.WriteResultAsync(
                    context,
                    commandContext,
                    feature,
                    TogglyJsonSerializerContext.Default.FeatureDefinition,
                    f => FormatFeature(f));
            });

    private static FilterBuilderOptions AddFilterBuilderOptions(Command command)
    {
        var enableOption = new Option<bool>("--enable", "Enable the feature (sets AlwaysOn filter)");
        var percentageOption = new Option<double?>("--percentage", "Build a Percentage filter with this rollout value (0-100)");
        var targetingUsersOption = new Option<string?>("--targeting-users", "Comma-separated user ids for a Targeting filter");
        var targetingGroupsOption = new Option<string?>("--targeting-groups", "Comma-separated group names for a Targeting filter");
        var targetingDefaultRolloutOption = new Option<double?>(
            "--targeting-default-rollout",
            "Targeting filter default rollout percentage (0-100)");
        var targetingIgnoreCaseOption = new Option<bool>("--targeting-ignore-case", "Targeting filter: ignore case when matching users/groups");
        var timeWindowStartOption = new Option<string?>("--time-window-start", "Build a TimeWindow filter starting at this ISO-8601 timestamp");
        var timeWindowEndOption = new Option<string?>("--time-window-end", "Build a TimeWindow filter ending at this ISO-8601 timestamp");

        command.AddOption(enableOption);
        command.AddOption(percentageOption);
        command.AddOption(targetingUsersOption);
        command.AddOption(targetingGroupsOption);
        command.AddOption(targetingDefaultRolloutOption);
        command.AddOption(targetingIgnoreCaseOption);
        command.AddOption(timeWindowStartOption);
        command.AddOption(timeWindowEndOption);

        return new FilterBuilderOptions(
            enableOption,
            percentageOption,
            targetingUsersOption,
            targetingGroupsOption,
            targetingDefaultRolloutOption,
            targetingIgnoreCaseOption,
            timeWindowStartOption,
            timeWindowEndOption);
    }

    private static Command CreateCreateCommand(
        string name,
        string description,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command(name, description);

        var applicationIdOption = CommandOptions.CreateAppOption();
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
        var environmentOption = CommandOptions.CreateEnvOption(
            "Environment name to apply first-class filter options (--percentage, --targeting-*, --time-window-*) to");
        var variantsOption = new Option<string?>(
            "--variants",
            "JSON array of variants. Format: [{\"name\":\"Control\",\"configurationValue\":false}]");
        var allocationOption = new Option<string?>(
            "--allocation",
            "JSON allocation object. Format: {\"percentile\":[{\"variant\":\"Control\",\"from\":0,\"to\":50}]}");

        command.AddOption(applicationIdOption);
        command.AddOption(nameOption);
        command.AddOption(featureKeyOption);
        command.AddOption(descriptionOption);
        command.AddOption(categoryOption);
        command.AddOption(tagsOption);
        command.AddOption(environmentFiltersOption);
        command.AddOption(environmentOption);
        var filterBuilderOptions = AddFilterBuilderOptions(command);
        command.AddOption(variantsOption);
        command.AddOption(allocationOption);

        var options = new CreateFeatureOptions(
            applicationIdOption,
            nameOption,
            featureKeyOption,
            descriptionOption,
            categoryOption,
            tagsOption,
            environmentFiltersOption,
            environmentOption,
            filterBuilderOptions,
            variantsOption,
            allocationOption);

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
        // NOTE: --filters / --enable / --percentage / --targeting-* / --time-window-* here set
        // FeatureDefinition.Filters — the definition-level *base/default* filters used to seed a
        // feature when it is added to a new environment (see
        // ApplicationFeatureMutationService.AddDefinitionToEnvironment in the SaaS). They are
        // NOT per-environment overrides: those live on `feature update-environment` /
        // `update-feature-environment`, which write ApplicationEnvironment.Definitions for one
        // named environment. Omitting all filter options here leaves the feature's existing base
        // filters untouched (no HTTP read-modify-write is performed).
        var command = new Command(
            name,
            description + ". --filters / --enable / --percentage / --targeting-* / --time-window-* set "
                + "the definition-level base filters (used when provisioning new environments); "
                + "per-environment overrides are set via 'feature update-environment'.");

        var applicationIdOption = CommandOptions.CreateAppOption();
        var featureKeyOption = new Option<string>("--feature-key", "Feature key to update") { IsRequired = true };
        var nameOption = new Option<string?>("--name", "Feature display name");
        var descriptionOption = new Option<string?>("--description", "Feature description");
        var categoryOption = new Option<string?>("--category", "Feature category");
        var tagsOption = new Option<string?>("--tags", "Comma-separated list of tags");
        var variantsOption = new Option<string?>(
            "--variants",
            "JSON array of variants. Format: [{\"name\":\"Control\",\"configurationValue\":false}]");
        var allocationOption = new Option<string?>(
            "--allocation",
            "JSON allocation object. Format: {\"percentile\":[{\"variant\":\"Control\",\"from\":0,\"to\":50}]}");
        var filtersOption = new Option<string?>(
            "--filters",
            "JSON array of filter objects to set as the definition-level base filters "
                + "(used when provisioning new environments; does not change existing per-environment overrides)");

        command.AddOption(applicationIdOption);
        command.AddOption(featureKeyOption);
        command.AddOption(nameOption);
        command.AddOption(descriptionOption);
        command.AddOption(categoryOption);
        command.AddOption(tagsOption);
        command.AddOption(variantsOption);
        command.AddOption(allocationOption);
        command.AddOption(filtersOption);
        var filterBuilderOptions = AddFilterBuilderOptions(command);

        var options = new UpdateFeatureOptions(
            applicationIdOption,
            featureKeyOption,
            nameOption,
            descriptionOption,
            categoryOption,
            tagsOption,
            variantsOption,
            allocationOption,
            filtersOption,
            filterBuilderOptions);

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
        var command = new Command(
            name,
            description + ". Specify one or more of --enable, --percentage, --targeting-*, "
                + "--time-window-*, --filters, or --disable alone.");

        var applicationIdOption = CommandOptions.CreateAppOption();
        var environmentOption = CommandOptions.CreateEnvOption(
            "Environment name (e.g., Production, Staging)");
        var featureKeyOption = new Option<string>("--feature-key", "Feature key") { IsRequired = true };
        var disableOption = new Option<bool>("--disable", "Disable the feature (removes all filters)");
        var filtersOption = new Option<string?>(
            "--filters",
            "JSON array of filter objects. Format: [{\"name\":\"FilterName\",\"parameters\":{\"Key\":\"Value\"}}]");

        command.AddOption(applicationIdOption);
        command.AddOption(environmentOption);
        command.AddOption(featureKeyOption);
        command.AddOption(disableOption);
        command.AddOption(filtersOption);
        var filterBuilderOptions = AddFilterBuilderOptions(command);

        var options = new UpdateFeatureEnvironmentOptions(
            applicationIdOption,
            environmentOption,
            featureKeyOption,
            disableOption,
            filtersOption,
            filterBuilderOptions);

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
        if (!CommandOptions.TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        var name = context.ParseResult.GetValueForOption(options.Name)!;
        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var description = context.ParseResult.GetValueForOption(options.Description);
        var category = context.ParseResult.GetValueForOption(options.Category);
        var tags = context.ParseResult.GetValueForOption(options.Tags);
        var environmentFilters = context.ParseResult.GetValueForOption(options.EnvironmentFilters);
        var environment = context.ParseResult.GetValueForOption(options.Environment);
        var variantsJson = context.ParseResult.GetValueForOption(options.Variants);
        var allocationJson = context.ParseResult.GetValueForOption(options.Allocation);

        var model = new FeatureDefinitionCreateModel
        {
            Name = name,
            FeatureKey = featureKey,
            Description = description,
            Category = category
        };

        if (!string.IsNullOrEmpty(tags))
            model.Tags = tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        if (!TryApplyEnvironmentFilters(environmentFilters, model, out var environmentFiltersError))
        {
            await cli.Output.WriteErrorAsync(environmentFiltersError);
            context.ExitCode = 2;
            return;
        }

        if (!TryBuildFilters(context, options.FilterBuilder, allowEmpty: true, out var builtFilters, out _, out var builderError))
        {
            await cli.Output.WriteErrorAsync(builderError);
            context.ExitCode = 2;
            return;
        }

        if (builtFilters.Count > 0)
        {
            if (string.IsNullOrEmpty(environment))
            {
                await cli.Output.WriteErrorAsync(
                    "--percentage, --targeting-*, --time-window-*, and --enable require --environment when creating a feature");
                context.ExitCode = 2;
                return;
            }

            model.EnvironmentFilters ??= new Dictionary<string, List<FeatureFilter>>();
            if (model.EnvironmentFilters.TryGetValue(environment, out var existing))
                existing.AddRange(builtFilters);
            else
                model.EnvironmentFilters[environment] = builtFilters;
        }

        if (!TryApplyVariantsAndAllocation(variantsJson, allocationJson, model, out var variantsError))
        {
            await cli.Output.WriteErrorAsync(variantsError);
            context.ExitCode = 2;
            return;
        }

        await CommandOptions.RunApiAsync(context, cli, "Error creating feature", async () =>
        {
            var feature = await apiClient.CreateFeatureAsync(applicationId, model);
            await cli.Output.WriteAsync(
                context,
                feature,
                TogglyJsonSerializerContext.Default.FeatureDefinition,
                f => FormatFeature(f, "Feature created"));
        });
    }

    private static async Task HandleUpdateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        UpdateFeatureOptions options)
    {
        if (!CommandOptions.TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var name = context.ParseResult.GetValueForOption(options.Name);
        var description = context.ParseResult.GetValueForOption(options.Description);
        var category = context.ParseResult.GetValueForOption(options.Category);
        var tags = context.ParseResult.GetValueForOption(options.Tags);
        var variantsJson = context.ParseResult.GetValueForOption(options.Variants);
        var allocationJson = context.ParseResult.GetValueForOption(options.Allocation);
        var filtersJson = context.ParseResult.GetValueForOption(options.Filters);

        var model = new FeatureDefinition
        {
            FeatureKey = featureKey,
            Name = name ?? featureKey,
            Description = description,
            Category = category
        };

        if (!string.IsNullOrEmpty(tags))
            model.Tags = tags.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        if (!TryApplyVariantsAndAllocation(variantsJson, allocationJson, model, out var variantsError))
        {
            await cli.Output.WriteErrorAsync(variantsError);
            context.ExitCode = 2;
            return;
        }

        // Only touch the definition-level base filters when the caller actually asked to;
        // an empty/default list here would silently wipe existing base filters on every
        // metadata-only update (see the CreateUpdateCommand NOTE above). Use
        // anyFilterOptionProvided (not filters.Count > 0) so an explicit `--filters '[]'`
        // still sends an empty array — it means "clear filters", not "don't touch filters".
        if (!TryBuildFlatFilterList(context, options.FilterBuilder, filtersJson, out var filters, out var anyFilterOptionProvided, out var filtersError))
        {
            await cli.Output.WriteErrorAsync(filtersError);
            context.ExitCode = 2;
            return;
        }

        if (anyFilterOptionProvided)
            model.Filters = filters;

        await CommandOptions.RunApiAsync(context, cli, "Error updating feature", async () =>
        {
            var feature = await apiClient.UpdateFeatureAsync(applicationId, featureKey, model);
            await cli.Output.WriteAsync(
                context,
                feature,
                TogglyJsonSerializerContext.Default.FeatureDefinition,
                f => FormatFeature(f, "Feature updated"));
        });
    }

    private static async Task HandleUpdateFeatureEnvironmentAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CliCommandContext cli,
        UpdateFeatureEnvironmentOptions options)
    {
        if (!CommandOptions.TryResolveApp(context, cli, options.ApplicationId, out var applicationId))
            return;

        if (!CommandOptions.TryResolveEnv(context, cli, options.Environment, out var environment))
            return;

        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var disable = context.ParseResult.GetValueForOption(options.Disable);
        var filtersJson = context.ParseResult.GetValueForOption(options.Filters);

        if (!TryResolveFilterList(context, options, disable, filtersJson, out var filterList, out var errorMessage))
        {
            await cli.Output.WriteErrorAsync(errorMessage);
            context.ExitCode = 2;
            return;
        }

        await CommandOptions.RunApiAsync(context, cli, "Error updating feature environment", async () =>
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
        });
    }

    private static bool TryApplyEnvironmentFilters(
        string? environmentFilters,
        FeatureDefinitionCreateModel model,
        out string errorMessage)
    {
        errorMessage = string.Empty;
        if (string.IsNullOrEmpty(environmentFilters))
            return true;

        Dictionary<string, List<FeatureFilter>>? parsed;
        try
        {
            parsed = JsonSerializer.Deserialize(
                environmentFilters,
                TogglyJsonSerializerContext.Default.DictionaryStringListFeatureFilter);
        }
        catch (JsonException ex)
        {
            errorMessage = $"Error parsing environment filters: {ex.Message}";
            return false;
        }

        if (parsed is not null)
        {
            var errors = new List<string>();
            foreach (var (envName, filters) in parsed)
            {
                foreach (var error in FilterValidator.Validate(filters))
                    errors.Add($"{envName}: {error}");
            }

            if (errors.Count > 0)
            {
                errorMessage = $"Error validating environment filters: {string.Join("; ", errors)}";
                return false;
            }
        }

        model.EnvironmentFilters = parsed;
        return true;
    }

    private static bool TryApplyVariantsAndAllocation(
        string? variantsJson,
        string? allocationJson,
        FeatureDefinition model,
        out string errorMessage)
    {
        errorMessage = string.Empty;

        if (!string.IsNullOrEmpty(variantsJson))
        {
            if (!VariantPayload.TryParseVariants(variantsJson, out var variants, out errorMessage))
                return false;
            model.Variants = variants;
        }

        if (!string.IsNullOrEmpty(allocationJson))
        {
            var knownVariantNames = model.Variants?.Select(v => v.Name).ToList();
            if (!VariantPayload.TryParseAllocation(allocationJson, out var allocation, out errorMessage, knownVariantNames))
                return false;
            model.Allocation = allocation;
        }

        return true;
    }

    /// <summary>
    /// Builds a filter list from the first-class filter-builder options
    /// (--enable, --percentage, --targeting-*, --time-window-*). Returns an
    /// empty list (not an error) when none of the options are present.
    /// </summary>
    private static bool TryBuildFilters(
        InvocationContext context,
        FilterBuilderOptions options,
        bool allowEmpty,
        out List<FeatureFilter> filters,
        out bool anyOptionProvided,
        out string errorMessage)
    {
        filters = [];
        errorMessage = string.Empty;

        var enable = context.ParseResult.GetValueForOption(options.Enable);
        var percentage = context.ParseResult.GetValueForOption(options.Percentage);
        var targetingUsersRaw = context.ParseResult.GetValueForOption(options.TargetingUsers);
        var targetingGroupsRaw = context.ParseResult.GetValueForOption(options.TargetingGroups);
        var targetingDefaultRollout = context.ParseResult.GetValueForOption(options.TargetingDefaultRollout);
        var targetingIgnoreCase = context.ParseResult.GetValueForOption(options.TargetingIgnoreCase);
        var timeWindowStartRaw = context.ParseResult.GetValueForOption(options.TimeWindowStart);
        var timeWindowEndRaw = context.ParseResult.GetValueForOption(options.TimeWindowEnd);

        var targetingRequested = IsTargetingRequested(targetingUsersRaw, targetingGroupsRaw, targetingDefaultRollout, targetingIgnoreCase);
        var timeWindowRequested = IsTimeWindowRequested(timeWindowStartRaw, timeWindowEndRaw);
        anyOptionProvided = enable || percentage is not null || targetingRequested || timeWindowRequested;

        try
        {
            if (enable)
                filters.Add(FilterBuilder.AlwaysOn());

            if (percentage is not null)
                filters.Add(FilterBuilder.Percentage(percentage.Value));

            if (targetingRequested)
                filters.Add(BuildTargetingFilter(targetingUsersRaw, targetingGroupsRaw, targetingDefaultRollout, targetingIgnoreCase));

            if (timeWindowRequested)
            {
                if (!TryBuildTimeWindowFilter(timeWindowStartRaw, timeWindowEndRaw, out var timeWindowFilter, out errorMessage))
                    return false;

                filters.Add(timeWindowFilter);
            }
        }
        catch (ArgumentException ex)
        {
            errorMessage = ex.Message;
            return false;
        }

        if (!allowEmpty && filters.Count == 0)
        {
            errorMessage = "Must specify one of: --enable, --disable, --percentage, --targeting-users, "
                + "--targeting-groups, --targeting-default-rollout, --targeting-ignore-case, "
                + "--time-window-start, --time-window-end, or --filters";
            return false;
        }

        return true;
    }

    private static bool IsTargetingRequested(string? usersRaw, string? groupsRaw, double? defaultRollout, bool ignoreCase) =>
        !string.IsNullOrEmpty(usersRaw) || !string.IsNullOrEmpty(groupsRaw) || defaultRollout is not null || ignoreCase;

    private static bool IsTimeWindowRequested(string? startRaw, string? endRaw) =>
        !string.IsNullOrEmpty(startRaw) || !string.IsNullOrEmpty(endRaw);

    private static FeatureFilter BuildTargetingFilter(string? usersRaw, string? groupsRaw, double? defaultRollout, bool ignoreCase)
    {
        var users = SplitCsv(usersRaw);
        var groups = SplitCsv(groupsRaw);
        return FilterBuilder.Targeting(users, groups, defaultRollout, ignoreCase ? true : null);
    }

    private static bool TryBuildTimeWindowFilter(
        string? startRaw,
        string? endRaw,
        out FeatureFilter filter,
        out string errorMessage)
    {
        filter = null!;

        if (!TryParseTimestamp(startRaw, "--time-window-start", out var start, out errorMessage))
            return false;
        if (!TryParseTimestamp(endRaw, "--time-window-end", out var end, out errorMessage))
            return false;

        filter = FilterBuilder.TimeWindow(start, end);
        return true;
    }

    private static bool TryParseTimestamp(string? raw, string optionName, out DateTimeOffset? value, out string errorMessage)
    {
        value = null;
        errorMessage = string.Empty;
        if (string.IsNullOrEmpty(raw))
            return true;

        if (!DateTimeOffset.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var parsed))
        {
            errorMessage = $"{optionName}: '{raw}' is not a valid ISO-8601 timestamp";
            return false;
        }

        value = parsed;
        return true;
    }

    private static List<string>? SplitCsv(string? raw) =>
        string.IsNullOrEmpty(raw)
            ? null
            : raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    /// <summary>
    /// Builds a flat filter list by combining validated <c>--filters</c> JSON (if any) with
    /// filters built from the first-class filter-builder options (<see cref="TryBuildFilters"/>).
    /// An empty result (not an error) means neither was supplied. Shared by
    /// <c>update-feature</c> (definition-level base filters) and <c>update-feature-environment</c>
    /// (per-environment overrides, once <c>--disable</c> exclusivity is handled by the caller).
    /// <paramref name="anyFilterOptionProvided"/> is true when the caller explicitly passed
    /// <c>--filters</c> (even <c>'[]'</c>) and/or any filter-builder option — distinct from
    /// <c>filterList.Count &gt; 0</c>, which is false for an explicit <c>--filters '[]'</c>.
    /// Callers that need to distinguish "clear filters" from "don't touch filters" (e.g.
    /// <c>update-feature</c>, which treats a null/omitted <c>Filters</c> as "leave alone") must
    /// use this flag rather than <c>filterList.Count</c>.
    /// </summary>
    private static bool TryBuildFlatFilterList(
        InvocationContext context,
        FilterBuilderOptions filterBuilderOptions,
        string? filtersJson,
        out List<FeatureFilter> filterList,
        out bool anyFilterOptionProvided,
        out string errorMessage)
    {
        filterList = [];
        errorMessage = string.Empty;
        // Null, empty, or whitespace-only --filters all count as "not provided" — an
        // accidentally-blank value (e.g. `--filters ""` or `--filters "  "` from a shell
        // variable expansion) must not be treated as an explicit "clear filters" request.
        var filtersJsonProvided = !string.IsNullOrWhiteSpace(filtersJson);

        if (!string.IsNullOrWhiteSpace(filtersJson))
        {
            if (!FilterValidator.TryParseAndValidate(filtersJson, out var jsonFilters, out errorMessage))
            {
                anyFilterOptionProvided = filtersJsonProvided;
                return false;
            }

            filterList.AddRange(jsonFilters);
        }

        if (!TryBuildFilters(context, filterBuilderOptions, allowEmpty: true, out var builtFilters, out var builderOptionProvided, out errorMessage))
        {
            anyFilterOptionProvided = filtersJsonProvided || builderOptionProvided;
            return false;
        }

        filterList.AddRange(builtFilters);
        anyFilterOptionProvided = filtersJsonProvided || builderOptionProvided;
        return true;
    }

    private static bool TryResolveFilterList(
        InvocationContext context,
        UpdateFeatureEnvironmentOptions options,
        bool disable,
        string? filtersJson,
        out List<FeatureFilter> filterList,
        out string errorMessage)
    {
        filterList = [];
        errorMessage = string.Empty;

        if (disable)
        {
            if (!TryBuildFilters(context, options.FilterBuilder, allowEmpty: true, out var builtFilters, out _, out errorMessage))
                return false;

            if (builtFilters.Count > 0 || !string.IsNullOrWhiteSpace(filtersJson))
            {
                errorMessage = "--disable cannot be combined with --enable, --percentage, --targeting-*, "
                    + "--time-window-*, or --filters";
                return false;
            }

            return true;
        }

        // Use anyFilterOptionProvided (not filterList.Count) so an explicit `--filters '[]'`
        // is accepted as "clear this environment's filters" rather than rejected as if no
        // filter option were given at all.
        if (!TryBuildFlatFilterList(context, options.FilterBuilder, filtersJson, out filterList, out var anyFilterOptionProvided, out errorMessage))
            return false;

        if (!anyFilterOptionProvided)
        {
            errorMessage = "Must specify one of: --enable, --disable, --percentage, --targeting-users, "
                + "--targeting-groups, --targeting-default-rollout, --targeting-ignore-case, "
                + "--time-window-start, --time-window-end, or --filters";
            return false;
        }

        return true;
    }

    private static IEnumerable<string> FormatFeatureList(List<FeatureDefinition> features) =>
        CommandOptions.FormatListOrEmpty(features, "No features found.", f => FormatFeature(f));

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
