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
    public static Command CreateUpdateFeatureEnvironmentCommand(Func<InvocationContext, TogglyApiClient> apiClientFactory)
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
            var applicationId = context.ParseResult.GetValueForOption(applicationIdOption)!;
            var environment = context.ParseResult.GetValueForOption(environmentOption)!;
            var featureKey = context.ParseResult.GetValueForOption(featureKeyOption)!;
            var enable = context.ParseResult.GetValueForOption(enableOption);
            var disable = context.ParseResult.GetValueForOption(disableOption);
            var filters = context.ParseResult.GetValueForOption(filtersOption);

            List<FeatureFilter> filterList;

            if (enable && disable)
            {
                Console.Error.WriteLine("Cannot specify both --enable and --disable");
                context.ExitCode = 2;
                return;
            }

            if (enable)
            {
                filterList = new List<FeatureFilter>
                {
                    new FeatureFilter
                    {
                        Name = "AlwaysOn",
                        Parameters = new Dictionary<string, object>()
                    }
                };
            }
            else if (disable)
            {
                filterList = new List<FeatureFilter>();
            }
            else if (!string.IsNullOrEmpty(filters))
            {
                try
                {
                    filterList = JsonSerializer.Deserialize(filters, TogglyJsonSerializerContext.Default.ListFeatureFilter)
                        ?? new List<FeatureFilter>();
                }
                catch (JsonException ex)
                {
                    Console.Error.WriteLine($"Error parsing filters: {ex.Message}");
                    context.ExitCode = 2;
                    return;
                }
            }
            else
            {
                Console.Error.WriteLine("Must specify one of: --enable, --disable, or --filters");
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
                {
                    Console.WriteLine($"  - {filter.Name}");
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error updating feature environment: {ex.Message}");
                context.ExitCode = 1;
            }
        });

        return command;
    }
}

