using System.Text.Json.Serialization;

namespace Toggly.CLI.UnleashMigration;

/// <summary>
/// AOT-safe JSON context for Unleash export DTOs used by <see cref="UnleashExportParser"/>.
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = true,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(UnleashFeatureExport))]
[JsonSerializable(typeof(UnleashFeatureDto))]
[JsonSerializable(typeof(List<UnleashFeatureDto>), TypeInfoPropertyName = "ListUnleashFeatureDto")]
[JsonSerializable(typeof(UnleashEnvironmentDto))]
[JsonSerializable(typeof(List<UnleashEnvironmentDto>), TypeInfoPropertyName = "ListUnleashEnvironmentDto")]
[JsonSerializable(typeof(UnleashStrategyDto))]
[JsonSerializable(typeof(List<UnleashStrategyDto>), TypeInfoPropertyName = "ListUnleashStrategyDto")]
[JsonSerializable(typeof(UnleashConstraintDto))]
[JsonSerializable(typeof(List<UnleashConstraintDto>), TypeInfoPropertyName = "ListUnleashConstraintDto")]
[JsonSerializable(typeof(UnleashVariantDto))]
[JsonSerializable(typeof(List<UnleashVariantDto>), TypeInfoPropertyName = "ListUnleashVariantDto")]
[JsonSerializable(typeof(UnleashVariantPayloadDto))]
[JsonSerializable(typeof(Dictionary<string, string>), TypeInfoPropertyName = "DictionaryStringString")]
[JsonSerializable(typeof(UnleashCompatibilityReportJson))]
[JsonSerializable(typeof(UnleashCompatibilityReportRow))]
[JsonSerializable(typeof(List<UnleashCompatibilityReportRow>), TypeInfoPropertyName = "ListUnleashCompatibilityReportRow")]
[JsonSerializable(typeof(UnleashMappingStatus))]
public partial class UnleashJsonSerializerContext : JsonSerializerContext
{
}
