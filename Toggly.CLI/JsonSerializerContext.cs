using System.Text.Json.Serialization;
using Toggly.CLI.Models;

namespace Toggly.CLI;

/// <summary>
/// JSON serializer context for AOT compilation support
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = false)]
[JsonSerializable(typeof(CreateReleaseRequest))]
[JsonSerializable(typeof(AssociateBuildRequest))]
[JsonSerializable(typeof(ReleaseModel))]
[JsonSerializable(typeof(AssociateBuildResponse))]
[JsonSerializable(typeof(FeatureDefinition))]
[JsonSerializable(typeof(FeatureDefinitionCreateModel))]
[JsonSerializable(typeof(FeatureFilter))]
[JsonSerializable(typeof(FeatureChangeRequest))]
[JsonSerializable(typeof(List<FeatureFilter>), TypeInfoPropertyName = "ListFeatureFilter")]
[JsonSerializable(typeof(List<FeatureChangeRequest>), TypeInfoPropertyName = "ListFeatureChangeRequest")]
[JsonSerializable(typeof(Dictionary<string, List<FeatureFilter>>), TypeInfoPropertyName = "DictionaryStringListFeatureFilter")]
[JsonSerializable(typeof(Services.AuthService.TokenResponse))]
[JsonSerializable(typeof(Services.AuthService.OpenIdConfig))]
public partial class TogglyJsonSerializerContext : JsonSerializerContext
{
}

