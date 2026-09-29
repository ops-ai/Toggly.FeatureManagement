using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Toggly.CLI;

namespace Toggly.CLI.Commands;

/// <summary>
/// Environment-related commands
/// </summary>
public static class EnvironmentCommands
{
    /// <summary>
    /// Create the update-feature-environment command
    /// </summary>
    public static Command CreateUpdateFeatureEnvironmentCommand(Func<InvocationContext, TogglyApiClient?> apiClientFactory)
    {
        var command = new Command("update-feature-environment", "Update feature configuration on a specific environment");

        var applicationIdOption = new Option<string>(
            "--application-id",
            description: "Application ID")
        {
            IsRequired = true
        };

        var environmentOption = new Option<string>(
            "--environment",
            description: "Environment name (e.g., Production, Staging)")
        {
            IsRequired = true
        };

        var featureKeyOption = new Option<string>(
            "--feature-key",
            description: "Feature key")
        {
            IsRequired = true
        };

        var enableOption = new Option<bool>(
            "--enable",
            description: "Enable the feature (sets AlwaysOn filter)");

        var disableOption = new Option<bool>(
            "--disable",
            description: "Disable the feature (removes all filters)");

        var filtersOption = new Option<string?>(
            "--filters",
            description: "JSON array of filter objects. Format: [{\"name\":\"FilterName\",\"parameters\":{\"Key\":\"Value\"}}]");

        command.AddOption(applicationIdOption);
        command.AddOption(environmentOption);
        command.AddOption(featureKeyOption);
        command.AddOption(enableOption);
        command.AddOption(disableOption);
        command.AddOption(filtersOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await HandleUpdateFeatureEnvironmentAsync(
                context,
                apiClient,
                applicationIdOption,
                environmentOption,
                featureKeyOption,
                enableOption,
                disableOption,
                filtersOption);
        });

        return command;
    }

    private static async Task HandleUpdateFeatureEnvironmentAsync(
        InvocationContext context,
        TogglyApiClient apiClient,
        Option<string> applicationIdOption,
        Option<string> environmentOption,
        Option<string> featureKeyOption,
        Option<bool> enableOption,
        Option<bool> disableOption,
        Option<string?> filtersOption)
    {
        var applicationId = context.ParseResult.GetValueForOption(applicationIdOption)!;
        var environment = context.ParseResult.GetValueForOption(environmentOption)!;
        var featureKey = context.ParseResult.GetValueForOption(featureKeyOption)!;
        var enable = context.ParseResult.GetValueForOption(enableOption);
        var disable = context.ParseResult.GetValueForOption(disableOption);
        var filters = context.ParseResult.GetValueForOption(filtersOption);

        if (!TryResolveFilterList(enable, disable, filters, out var filterList, out var errorMessage))
        {
            Console.Error.WriteLine(errorMessage);
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

            Console.WriteLine($"Feature '{featureKey}' updated in environment '{environment}'");
            Console.WriteLine($"Filters: {updatedFilters.Count}");
            foreach (var filter in updatedFilters)
                Console.WriteLine($"  - {filter.Name}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error updating feature environment: {ex.Message}");
            context.ExitCode = 1;
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
}
