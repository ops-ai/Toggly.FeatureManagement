using System.Text.Json.Serialization;

namespace Toggly.CLI.Models;

/// <summary>
/// Request to create a new release
/// </summary>
public class CreateReleaseRequest
{
    /// <summary>
    /// Application ID
    /// </summary>
    [JsonPropertyName("applicationId")]
    public required string ApplicationId { get; set; }

    /// <summary>
    /// Release name
    /// </summary>
    [JsonPropertyName("name")]
    public required string Name { get; set; }

    /// <summary>
    /// Release notes
    /// </summary>
    [JsonPropertyName("releaseNotes")]
    public string? ReleaseNotes { get; set; }

    /// <summary>
    /// Feature flag changes
    /// </summary>
    [JsonPropertyName("featureChanges")]
    public List<FeatureChangeRequest> FeatureChanges { get; set; } = new();
}

/// <summary>
/// Feature change request
/// </summary>
public class FeatureChangeRequest
{
    /// <summary>
    /// Feature flag key
    /// </summary>
    [JsonPropertyName("flagKey")]
    public required string FlagKey { get; set; }

    /// <summary>
    /// To state (desired state)
    /// </summary>
    [JsonPropertyName("toState")]
    public required List<FeatureFilter> ToState { get; set; }
}

/// <summary>
/// Request to associate a CI build with a release
/// </summary>
public class AssociateBuildRequest
{
    /// <summary>
    /// Project key (Application Id or Name)
    /// </summary>
    [JsonPropertyName("projectKey")]
    public required string ProjectKey { get; set; }

    /// <summary>
    /// Environment name
    /// </summary>
    [JsonPropertyName("environment")]
    public required string Environment { get; set; }

    /// <summary>
    /// CI provider (e.g., "azure-devops", "github", "gitlab", "jenkins", "circleci")
    /// </summary>
    [JsonPropertyName("ciProvider")]
    public required string CiProvider { get; set; }

    /// <summary>
    /// Build information
    /// </summary>
    [JsonPropertyName("build")]
    public required BuildInfo Build { get; set; }

    /// <summary>
    /// Mode for finding/creating release (e.g., "use-latest-draft-or-create")
    /// </summary>
    [JsonPropertyName("mode")]
    public string Mode { get; set; } = "use-latest-draft-or-create";

    /// <summary>
    /// Criteria for matching existing releases
    /// </summary>
    [JsonPropertyName("matchCriteria")]
    public MatchCriteria? MatchCriteria { get; set; }

    /// <summary>
    /// Release template key to use when creating new release
    /// </summary>
    [JsonPropertyName("releaseTemplateKey")]
    public string? ReleaseTemplateKey { get; set; }

    /// <summary>
    /// Options for creating a new release
    /// </summary>
    [JsonPropertyName("createOptions")]
    public CreateReleaseOptions? CreateOptions { get; set; }
}

/// <summary>
/// CI build information
/// </summary>
public class BuildInfo
{
    /// <summary>
    /// CI run/build ID
    /// </summary>
    [JsonPropertyName("runId")]
    public required string RunId { get; set; }

    /// <summary>
    /// URL to the CI run/build
    /// </summary>
    [JsonPropertyName("runUrl")]
    public string? RunUrl { get; set; }

    /// <summary>
    /// Pipeline name
    /// </summary>
    [JsonPropertyName("pipelineName")]
    public required string PipelineName { get; set; }

    /// <summary>
    /// Git branch name
    /// </summary>
    [JsonPropertyName("branch")]
    public string? Branch { get; set; }

    /// <summary>
    /// Git commit SHA
    /// </summary>
    [JsonPropertyName("commitSha")]
    public string? CommitSha { get; set; }

    /// <summary>
    /// Build number
    /// </summary>
    [JsonPropertyName("buildNumber")]
    public string? BuildNumber { get; set; }
}

/// <summary>
/// Criteria for matching existing releases
/// </summary>
public class MatchCriteria
{
    /// <summary>
    /// Match by branch
    /// </summary>
    [JsonPropertyName("byBranch")]
    public bool ByBranch { get; set; }

    /// <summary>
    /// Branch pattern to match
    /// </summary>
    [JsonPropertyName("branchPattern")]
    public string? BranchPattern { get; set; }

    /// <summary>
    /// Match by service/project
    /// </summary>
    [JsonPropertyName("byService")]
    public bool ByService { get; set; }
}

/// <summary>
/// Options for creating a new release
/// </summary>
public class CreateReleaseOptions
{
    /// <summary>
    /// Name pattern for release (Handlebars-style: ${branch}, ${buildNumber}, ${commitSha})
    /// </summary>
    [JsonPropertyName("namePattern")]
    public string? NamePattern { get; set; }
}

/// <summary>
/// Response from associating a build with a release
/// </summary>
public class AssociateBuildResponse
{
    /// <summary>
    /// Release ID
    /// </summary>
    [JsonPropertyName("releaseId")]
    public required string ReleaseId { get; set; }

    /// <summary>
    /// URL to view the release in the UI
    /// </summary>
    [JsonPropertyName("releaseUrl")]
    public string? ReleaseUrl { get; set; }
}

/// <summary>
/// Feature filter
/// </summary>
public class FeatureFilter
{
    /// <summary>
    /// Unique name of filter
    /// </summary>
    [JsonPropertyName("name")]
    public required string Name { get; set; }

    /// <summary>
    /// Parameters for the filter
    /// </summary>
    [JsonPropertyName("parameters")]
    public Dictionary<string, object>? Parameters { get; set; }
}

/// <summary>
/// Feature definition
/// </summary>
public class FeatureDefinition
{
    /// <summary>
    /// Feature display name
    /// </summary>
    [JsonPropertyName("name")]
    public required string Name { get; set; }

    /// <summary>
    /// Feature key used as reference in application
    /// </summary>
    [JsonPropertyName("featureKey")]
    public required string FeatureKey { get; set; }

    /// <summary>
    /// Description of what the feature is
    /// </summary>
    [JsonPropertyName("description")]
    public string? Description { get; set; }

    /// <summary>
    /// Optional category to group features by
    /// </summary>
    [JsonPropertyName("category")]
    public string? Category { get; set; }

    /// <summary>
    /// Optional list of tags
    /// </summary>
    [JsonPropertyName("tags")]
    public List<string>? Tags { get; set; }

    /// <summary>
    /// List of filters the feature is enabled for
    /// </summary>
    [JsonPropertyName("filters")]
    public List<FeatureFilter> Filters { get; set; } = new();

    /// <summary>
    /// Feature is configurable for security
    /// </summary>
    [JsonPropertyName("securedFeature")]
    public bool SecuredFeature { get; set; }

    /// <summary>
    /// Feature is available to client SDKs (vs server-side only)
    /// </summary>
    [JsonPropertyName("clientSdkEnabled")]
    public bool ClientSdkEnabled { get; set; } = true;

    /// <summary>
    /// Date of creation
    /// </summary>
    [JsonPropertyName("createdOnUtc")]
    public DateTime CreatedOnUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// Request model for creating a feature definition
/// </summary>
public class FeatureDefinitionCreateModel : FeatureDefinition
{
    /// <summary>
    /// Optional environment-specific filters.
    /// Key: environment name. Value: list of filters for that environment.
    /// </summary>
    [JsonPropertyName("environmentFilters")]
    public Dictionary<string, List<FeatureFilter>>? EnvironmentFilters { get; set; }
}

/// <summary>
/// Release model
/// </summary>
public class ReleaseModel
{
    /// <summary>
    /// Release ID
    /// </summary>
    [JsonPropertyName("id")]
    public required string Id { get; set; }

    /// <summary>
    /// Application ID
    /// </summary>
    [JsonPropertyName("applicationId")]
    public required string ApplicationId { get; set; }

    /// <summary>
    /// Release name
    /// </summary>
    [JsonPropertyName("name")]
    public required string Name { get; set; }

    /// <summary>
    /// Release notes
    /// </summary>
    [JsonPropertyName("releaseNotes")]
    public string? ReleaseNotes { get; set; }
}

