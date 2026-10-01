using System.Text.Json.Serialization;
using Toggly.CLI.Models;
using Toggly.CLI.Variants;

namespace Toggly.CLI;

/// <summary>
/// JSON serializer context for AOT compilation support
/// </summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = false)]
[JsonSerializable(typeof(System.Text.Json.JsonElement))]
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
[JsonSerializable(typeof(ApplicationSummary))]
[JsonSerializable(typeof(List<ApplicationSummary>), TypeInfoPropertyName = "ListApplicationSummary")]
[JsonSerializable(typeof(EnvironmentSummary))]
[JsonSerializable(typeof(List<EnvironmentSummary>), TypeInfoPropertyName = "ListEnvironmentSummary")]
[JsonSerializable(typeof(ReleaseSummary))]
[JsonSerializable(typeof(List<ReleaseSummary>), TypeInfoPropertyName = "ListReleaseSummary")]
[JsonSerializable(typeof(List<FeatureDefinition>), TypeInfoPropertyName = "ListFeatureDefinition")]
[JsonSerializable(typeof(VariantModel))]
[JsonSerializable(typeof(List<VariantModel>), TypeInfoPropertyName = "ListVariantModel")]
[JsonSerializable(typeof(VariantAllocationModel))]
[JsonSerializable(typeof(UserAllocationModel))]
[JsonSerializable(typeof(List<UserAllocationModel>), TypeInfoPropertyName = "ListUserAllocationModel")]
[JsonSerializable(typeof(GroupAllocationModel))]
[JsonSerializable(typeof(List<GroupAllocationModel>), TypeInfoPropertyName = "ListGroupAllocationModel")]
[JsonSerializable(typeof(PercentileAllocationModel))]
[JsonSerializable(typeof(List<PercentileAllocationModel>), TypeInfoPropertyName = "ListPercentileAllocationModel")]
[JsonSerializable(typeof(ContextPrefs))]
[JsonSerializable(typeof(Services.AuthService.TokenResponse))]
[JsonSerializable(typeof(Services.AuthService.OpenIdConfig))]
[JsonSerializable(typeof(Services.AuthService.DeviceAuthorizationResponse))]
[JsonSerializable(typeof(Services.AuthService.OAuthErrorResponse))]
[JsonSerializable(typeof(AuthSession))]
public partial class TogglyJsonSerializerContext : JsonSerializerContext
{
}
