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
        var applyOption = new Option<bool>(
            "--apply",
            "Create missing features and set environment filters via the Toggly API (does not require a prior dry-run)");

        command.AddOption(fileOption);
        command.AddOption(appOption);
        command.AddOption(envOption);
        command.AddOption(dryRunOption);
        command.AddOption(applyOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            await HandleUnleashAsync(
                context,
                cli,
                apiClientFactory,
                context.ParseResult.GetValueForOption(fileOption)!,
                context.ParseResult.GetValueForOption(applyOption),
                context.ParseResult.GetValueForOption(dryRunOption),
                appOption,
                envOption);
        });

        return command;
    }

    private static async Task HandleUnleashAsync(
        InvocationContext context,
        CliCommandContext cli,
        Func<InvocationContext, TogglyApiClient?> apiClientFactory,
        FileInfo file,
        bool apply,
        bool dryRun,
        Option<string?> appOption,
        Option<string?> envOption)
    {
        if (apply && dryRun)
        {
            await cli.Output.WriteErrorAsync("Specify either --apply or --dry-run, not both.");
            context.ExitCode = 2;
            return;
        }

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

        if (!TryParseUnleashExport(file.FullName, environment, out var parsed, out var parseError))
        {
            await cli.Output.WriteErrorAsync($"Failed to parse Unleash export: {parseError}");
            context.ExitCode = 1;
            return;
        }

        var plan = BuildImportPlan(parsed.Features);
        var reportText = plan.Report.ToText();
        var skippedImportWarnings = plan.Items
            .Where(item => item.Status == UnleashMappingStatus.Skipped)
            .Select(item => $"WARN: Skipped strategies for '{item.FeatureKey}': {item.Note}")
            .ToArray();

        if (!apply)
        {
            await cli.Output.WriteLinesAsync([
                $"Dry-run import into app '{applicationId}' environment '{environment}'",
                $"Accepted shape: {parsed.AcceptedShape}",
                $"Features: {parsed.Features.Count}",
                reportText,
                .. skippedImportWarnings
            ]);
            context.ExitCode = 0;
            return;
        }

        var apiClient = apiClientFactory(context);
        if (apiClient is null)
            return;

        await CommandOptions.RunApiAsync(context, cli, "Error applying Unleash import", () =>
            ApplyUnleashImportAsync(
                context,
                cli,
                apiClient,
                applicationId,
                environment,
                plan,
                reportText,
                skippedImportWarnings));
    }

    private static bool TryParseUnleashExport(
        string filePath,
        string environment,
        out UnleashParseResult parsed,
        out string errorMessage)
    {
        try
        {
            parsed = UnleashExportParser.ParseFile(filePath, environment);
            errorMessage = string.Empty;
            return true;
        }
        catch (Exception ex) when (
            ex is InvalidOperationException
                or JsonException
                or IOException
                or ArgumentException)
        {
            parsed = null!;
            errorMessage = ex.Message;
            return false;
        }
    }

    private static async Task ApplyUnleashImportAsync(
        InvocationContext context,
        CliCommandContext cli,
        TogglyApiClient apiClient,
        string applicationId,
        string environment,
        UnleashImportPlan plan,
        string reportText,
        string[] skippedImportWarnings)
    {
        var existing = await apiClient.ListFeaturesAsync(applicationId, context.GetCancellationToken());
        var existingKeys = existing
            .Select(f => f.FeatureKey)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var created = 0;
        var updated = 0;

        foreach (var item in plan.Items)
        {
            if (existingKeys.Contains(item.FeatureKey))
            {
                await apiClient.UpdateFeatureEnvironmentAsync(
                    applicationId,
                    environment,
                    item.FeatureKey,
                    item.Filters,
                    context.GetCancellationToken());
                updated++;
                continue;
            }

            var model = new FeatureDefinitionCreateModel
            {
                Name = string.IsNullOrWhiteSpace(item.DisplayName) ? item.FeatureKey : item.DisplayName,
                FeatureKey = item.FeatureKey,
                Description = item.Description,
                EnvironmentFilters = new Dictionary<string, List<FeatureFilter>>
                {
                    [environment] = item.Filters
                }
            };

            await apiClient.CreateFeatureAsync(applicationId, model, context.GetCancellationToken());
            existingKeys.Add(item.FeatureKey);
            created++;
        }

        await cli.Output.WriteLinesAsync([
            $"Applied Unleash import into app '{applicationId}' environment '{environment}'",
            $"Created: {created}  Updated: {updated}",
            reportText,
            .. skippedImportWarnings
        ]);
    }

    internal static UnleashImportPlan BuildImportPlan(IReadOnlyList<UnleashFeatureDto> features)
    {
        var report = new UnleashCompatibilityReport();
        var items = new List<UnleashImportPlanItem>();

        foreach (var feature in features)
        {
            if (string.IsNullOrWhiteSpace(feature.Name))
                continue;

            var item = MapFeatureToPlanItem(feature);
            report.Add(feature.Name, item.Status, item.Note);
            items.Add(item);
        }

        return new UnleashImportPlan(report, items);
    }

    private static UnleashImportPlanItem MapFeatureToPlanItem(UnleashFeatureDto feature)
    {
        if (feature.UnmatchedRequestedEnvironment is { } requestedEnv)
            return CreateUnmatchedEnvironmentItem(feature, requestedEnv);

        var mapped = UnleashStrategyMapper.Map(feature.Strategies, feature.Name);
        var status = mapped.Status;
        var note = mapped.Note;
        var filters = mapped.Filters;
        var enabled = feature.Enabled;

        if (feature.Variants is { Count: > 0 })
        {
            if (status != UnleashMappingStatus.Skipped)
                status = UnleashMappingStatus.Partial;
            note = AppendNote(note, "variants not imported");
        }

        if (!enabled)
        {
            filters = [];
            note = AppendNote(note, "disabled in Unleash; import as off");
        }
        else if (status == UnleashMappingStatus.Skipped)
        {
            filters = [];
            note = AppendNote(note, "will import as disabled/off");
        }

        return new UnleashImportPlanItem(
            feature.Name,
            feature.Name,
            feature.Description,
            enabled && filters.Count > 0,
            filters,
            status,
            note);
    }

    private static UnleashImportPlanItem CreateUnmatchedEnvironmentItem(
        UnleashFeatureDto feature,
        string requestedEnv)
    {
        var present = feature.PresentUnleashEnvironmentNames is { Count: > 0 }
            ? string.Join(", ", feature.PresentUnleashEnvironmentNames)
            : "(none)";
        var note =
            $"requested environment '{requestedEnv}' did not match Unleash environments: {present}; will import as disabled/off";

        return new UnleashImportPlanItem(
            feature.Name,
            feature.Name,
            feature.Description,
            false,
            [],
            UnleashMappingStatus.Skipped,
            note);
    }

    private static string AppendNote(string note, string addition)
    {
        if (string.IsNullOrWhiteSpace(note))
            return addition;

        return $"{note}; {addition}";
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
