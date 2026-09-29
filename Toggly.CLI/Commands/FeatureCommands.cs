using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Toggly.CLI;

namespace Toggly.CLI.Commands;

/// <summary>
/// Feature-related commands
/// </summary>
public static class FeatureCommands
{
    private sealed record CreateFeatureOptions(
        Option<string> ApplicationId,
        Option<string> Name,
        Option<string> FeatureKey,
        Option<string?> Description,
        Option<string?> Category,
        Option<string?> Tags,
        Option<string?> EnvironmentFilters);

    private sealed record UpdateFeatureOptions(
        Option<string> ApplicationId,
        Option<string> FeatureKey,
        Option<string?> Name,
        Option<string?> Description,
        Option<string?> Category,
        Option<string?> Tags);

    /// <summary>
    /// Create the feature command group
    /// </summary>
    public static Command CreateFeatureCommand(Func<InvocationContext, TogglyApiClient?> apiClientFactory)
    {
        var command = new Command("create-feature", "Create a new feature");

        var applicationIdOption = new Option<string>(
            "--application-id",
            description: "Application ID")
        {
            IsRequired = true
        };

        var nameOption = new Option<string>(
            "--name",
            description: "Feature display name")
        {
            IsRequired = true
        };

        var featureKeyOption = new Option<string>(
            "--feature-key",
            description: "Feature key (used as reference in application)")
        {
            IsRequired = true
        };

        var descriptionOption = new Option<string?>(
            "--description",
            description: "Feature description");

        var categoryOption = new Option<string?>(
            "--category",
            description: "Feature category");

        var tagsOption = new Option<string?>(
            "--tags",
            description: "Comma-separated list of tags");

        var environmentFiltersOption = new Option<string?>(
            "--environment-filters",
            description: "JSON object mapping environment names to filter arrays. Format: {\"Production\":[{\"name\":\"AlwaysOn\",\"parameters\":{}}]}");

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

            await HandleCreateFeatureAsync(context, apiClient, options);
        });

        return command;
    }

    /// <summary>
    /// Create the update-feature command
    /// </summary>
    public static Command CreateUpdateFeatureCommand(Func<InvocationContext, TogglyApiClient?> apiClientFactory)
    {
        var command = new Command("update-feature", "Update an existing feature");

        var applicationIdOption = new Option<string>(
            "--application-id",
            description: "Application ID")
        {
            IsRequired = true
        };

        var featureKeyOption = new Option<string>(
            "--feature-key",
            description: "Feature key to update")
        {
            IsRequired = true
        };

        var nameOption = new Option<string?>(
            "--name",
            description: "Feature display name");

        var descriptionOption = new Option<string?>(
            "--description",
            description: "Feature description");

        var categoryOption = new Option<string?>(
            "--category",
            description: "Feature category");

        var tagsOption = new Option<string?>(
            "--tags",
            description: "Comma-separated list of tags");

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

            await HandleUpdateFeatureAsync(context, apiClient, options);
        });

        return command;
    }

    private static async Task HandleCreateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        CreateFeatureOptions options)
    {
        var applicationId = context.ParseResult.GetValueForOption(options.ApplicationId)!;
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
            await Console.Error.WriteLineAsync(parseError);
            context.ExitCode = 2;
            return;
        }

        try
        {
            var feature = await apiClient.CreateFeatureAsync(applicationId, model);
            await WriteFeatureSummaryAsync("Feature created", feature);
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"Error creating feature: {ex.Message}");
            context.ExitCode = 1;
        }
    }

    private static async Task HandleUpdateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        UpdateFeatureOptions options)
    {
        var applicationId = context.ParseResult.GetValueForOption(options.ApplicationId)!;
        var featureKey = context.ParseResult.GetValueForOption(options.FeatureKey)!;
        var name = context.ParseResult.GetValueForOption(options.Name);
        var description = context.ParseResult.GetValueForOption(options.Description);
        var category = context.ParseResult.GetValueForOption(options.Category);
        var tags = context.ParseResult.GetValueForOption(options.Tags);

        // Note: In a real implementation, you'd first fetch the existing feature
        // For now, we'll create a minimal update model
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
            await WriteFeatureSummaryAsync("Feature updated", feature);
        }
        catch (Exception ex)
        {
            await Console.Error.WriteLineAsync($"Error updating feature: {ex.Message}");
            context.ExitCode = 1;
        }
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

    private static async Task WriteFeatureSummaryAsync(string verb, FeatureDefinition feature)
    {
        await Console.Out.WriteLineAsync($"{verb}: {feature.FeatureKey}");
        await Console.Out.WriteLineAsync($"Name: {feature.Name}");
        if (!string.IsNullOrEmpty(feature.Description))
            await Console.Out.WriteLineAsync($"Description: {feature.Description}");
    }
}
