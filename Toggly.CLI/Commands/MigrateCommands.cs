using System.CommandLine;
using System.CommandLine.Invocation;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Output;
using Toggly.CLI.Services;
using Toggly.CLI.UnleashMigration;

namespace Toggly.CLI.Commands;

/// <summary>
/// Migration commands (Unleash → Toggly importer).
/// </summary>
public static class MigrateCommands
{
    /// <summary>
    /// Create the <c>migrate</c> noun group.
    /// </summary>
    public static Command Create(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var migrate = new Command("migrate", "Import feature flags from other platforms into Toggly");
        migrate.AddCommand(CreateUnleashCommand(apiClientFactory, cli));
        return migrate;
    }

    private static Command CreateUnleashCommand(
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        CliCommandContext cli)
    {
        var command = new Command("unleash", "Import an Unleash export / Admin API feature list into a Toggly app");

        var fileOption = new Option<FileInfo>("--file", "Path to Unleash export JSON (or Admin API features payload)")
        {
            IsRequired = true
        };
        var appOption = CommandOptions.CreateAppOption();
        var envOption = CommandOptions.CreateEnvOption(
            "Toggly environment to import into (also used to select Unleash environment slices when present)");
        var dryRunOption = new Option<bool>("--dry-run", "Parse and print a compatibility report without API mutations (default)");
        var applyOption = new Option<bool>("--apply", "Create missing features and set environment filters via the Toggly API");

        command.AddOption(fileOption);
        command.AddOption(appOption);
        command.AddOption(envOption);
        command.AddOption(dryRunOption);
        command.AddOption(applyOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            var file = context.ParseResult.GetValueForOption(fileOption)!;
            var apply = context.ParseResult.GetValueForOption(applyOption);
            var dryRun = context.ParseResult.GetValueForOption(dryRunOption);

            if (apply && dryRun)
            {
                await cli.Output.WriteErrorAsync("Specify either --apply or --dry-run, not both.");
                context.ExitCode = 2;
                return;
            }

            // Default is dry-run when --apply is absent.
            var isApply = apply;

            if (!CommandOptions.TryResolveApp(context, cli, appOption, out var applicationId))
                return;

            if (!CommandOptions.TryResolveEnv(context, cli, envOption, out var environment))
                return;

            if (!file.Exists)
            {
                await cli.Output.WriteErrorAsync($"File not found: {file.FullName}");
                context.ExitCode = 2;
                return;
            }

            UnleashParseResult parsed;
            try
            {
                parsed = UnleashExportParser.ParseFile(file.FullName, environment);
            }
            catch (Exception ex) when (ex is InvalidOperationException or JsonException or IOException)
            {
                await cli.Output.WriteErrorAsync($"Failed to parse Unleash export: {ex.Message}");
                context.ExitCode = 1;
                return;
            }

            var plan = BuildImportPlan(parsed.Features);
            var reportText = plan.Report.ToText();

            if (!isApply)
            {
                await cli.Output.WriteLinesAsync([
                    $"Dry-run import into app '{applicationId}' environment '{environment}'",
                    $"Accepted shape: {parsed.AcceptedShape}",
                    $"Features: {parsed.Features.Count}",
                    reportText
                ]);
                context.ExitCode = 0;
                return;
            }

            var apiClient = apiClientFactory(context);
            if (apiClient is null)
                return;

            await CommandOptions.RunApiAsync(context, cli, "Error applying Unleash import", async () =>
            {
                var existing = await apiClient.ListFeaturesAsync(applicationId, context.GetCancellationToken());
                var existingKeys = existing
                    .Select(f => f.FeatureKey)
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                var created = 0;
                var updated = 0;
                var warnings = new List<string>();

                foreach (var item in plan.Items)
                {
                    if (item.Status == UnleashMappingStatus.Skipped)
                        warnings.Add($"Skipped strategies for '{item.FeatureKey}': {item.Note} (importing as off)");

                    var filtersForEnv = item.Filters;

                    if (!existingKeys.Contains(item.FeatureKey))
                    {
                        var model = new FeatureDefinitionCreateModel
                        {
                            Name = string.IsNullOrWhiteSpace(item.DisplayName) ? item.FeatureKey : item.DisplayName,
                            FeatureKey = item.FeatureKey,
                            Description = item.Description,
                            EnvironmentFilters = new Dictionary<string, List<FeatureFilter>>
                            {
                                [environment] = filtersForEnv
                            }
                        };

                        await apiClient.CreateFeatureAsync(applicationId, model, context.GetCancellationToken());
                        existingKeys.Add(item.FeatureKey);
                        created++;
                    }
                    else
                    {
                        await apiClient.UpdateFeatureEnvironmentAsync(
                            applicationId,
                            environment,
                            item.FeatureKey,
                            filtersForEnv,
                            context.GetCancellationToken());
                        updated++;
                    }
                }

                await cli.Output.WriteLinesAsync([
                    $"Applied Unleash import into app '{applicationId}' environment '{environment}'",
                    $"Created: {created}  Updated: {updated}",
                    reportText,
                    .. warnings.Select(w => $"WARN: {w}")
                ]);
            });
        });

        return command;
    }

    internal static UnleashImportPlan BuildImportPlan(IReadOnlyList<UnleashFeatureDto> features)
    {
        var report = new UnleashCompatibilityReport();
        var items = new List<UnleashImportPlanItem>();

        foreach (var feature in features)
        {
            if (string.IsNullOrWhiteSpace(feature.Name))
                continue;

            var mapped = UnleashStrategyMapper.Map(feature.Strategies, feature.Name);
            var status = mapped.Status;
            var note = mapped.Note;
            var filters = mapped.Filters;
            var enabled = feature.Enabled;

            if (!enabled)
            {
                filters = [];
                note = string.IsNullOrWhiteSpace(note)
                    ? "disabled in Unleash; import as off"
                    : $"{note}; disabled in Unleash; import as off";
            }
            else if (status == UnleashMappingStatus.Skipped)
            {
                // All strategies unsupported — still create as off.
                filters = [];
            }

            report.Add(feature.Name, status, note);
            items.Add(new UnleashImportPlanItem(
                feature.Name,
                feature.Name,
                feature.Description,
                enabled && filters.Count > 0,
                filters,
                status,
                note));
        }

        return new UnleashImportPlan(report, items);
    }

    internal sealed record UnleashImportPlan(
        UnleashCompatibilityReport Report,
        IReadOnlyList<UnleashImportPlanItem> Items);

    internal sealed record UnleashImportPlanItem(
        string FeatureKey,
        string DisplayName,
        string? Description,
        bool Enabled,
        List<FeatureFilter> Filters,
        UnleashMappingStatus Status,
        string Note);
}
