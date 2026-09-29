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

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleCreateFeatureAsync(
                context,
                apiClient,
                applicationIdOption,
                nameOption,
                featureKeyOption,
                descriptionOption,
                categoryOption,
                tagsOption,
                environmentFiltersOption);
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

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleUpdateFeatureAsync(
                context,
                apiClient,
                applicationIdOption,
                featureKeyOption,
                nameOption,
                descriptionOption,
                categoryOption,
                tagsOption);
        });

        return command;
    }

    private static async Task HandleCreateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        Option<string> applicationIdOption,
        Option<string> nameOption,
        Option<string> featureKeyOption,
        Option<string?> descriptionOption,
        Option<string?> categoryOption,
        Option<string?> tagsOption,
        Option<string?> environmentFiltersOption)
    {
        var applicationId = context.ParseResult.GetValueForOption(applicationIdOption)!;
        var name = context.ParseResult.GetValueForOption(nameOption)!;
        var featureKey = context.ParseResult.GetValueForOption(featureKeyOption)!;
        var description = context.ParseResult.GetValueForOption(descriptionOption);
        var category = context.ParseResult.GetValueForOption(categoryOption);
        var tags = context.ParseResult.GetValueForOption(tagsOption);
        var environmentFilters = context.ParseResult.GetValueForOption(environmentFiltersOption);

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
            Console.Error.WriteLine(parseError);
            context.ExitCode = 2;
            return;
        }

        try
        {
            var feature = await apiClient.CreateFeatureAsync(applicationId, model);
            WriteFeatureSummary("Feature created", feature);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error creating feature: {ex.Message}");
            context.ExitCode = 1;
        }
    }

    private static async Task HandleUpdateFeatureAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        Option<string> applicationIdOption,
        Option<string> featureKeyOption,
        Option<string?> nameOption,
        Option<string?> descriptionOption,
        Option<string?> categoryOption,
        Option<string?> tagsOption)
    {
        var applicationId = context.ParseResult.GetValueForOption(applicationIdOption)!;
        var featureKey = context.ParseResult.GetValueForOption(featureKeyOption)!;
        var name = context.ParseResult.GetValueForOption(nameOption);
        var description = context.ParseResult.GetValueForOption(descriptionOption);
        var category = context.ParseResult.GetValueForOption(categoryOption);
        var tags = context.ParseResult.GetValueForOption(tagsOption);

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
            WriteFeatureSummary("Feature updated", feature);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error updating feature: {ex.Message}");
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

    private static void WriteFeatureSummary(string verb, FeatureDefinition feature)
    {
        Console.WriteLine($"{verb}: {feature.FeatureKey}");
        Console.WriteLine($"Name: {feature.Name}");
        if (!string.IsNullOrEmpty(feature.Description))
            Console.WriteLine($"Description: {feature.Description}");
    }
}
