namespace Toggly.CLI.Services;

/// <summary>
/// Single source of management-API path templates used by <see cref="TogglyApiClient"/>.
/// Must stay in lockstep with <c>Contracts/cli-ops-routes.json</c> (enforced by drift tests).
/// </summary>
public static class CliApiRoutes
{
    public const string Applications = "/applications";
    public const string ApplicationById = "/applications/{id}";
    public const string Environments = "/applications/{id}/environments";
    public const string EnvironmentByName = "/applications/{id}/environments/{name}";
    public const string Features = "/applications/{id}/features";
    public const string FeatureByKey = "/applications/{id}/features/{key}";
    public const string FeatureEnvironment = "/applications/{id}/environments/{env}/features/{key}";
    public const string Releases = "/releases";
    public const string ReleaseById = "/releases/{releaseId}";
    public const string AssociateBuild = "/releases/associate-build";

    /// <summary>
    /// Curated ops routes the CLI calls. Auth token / device endpoints are documented in the
    /// ops subset notes and covered by AuthService tests — not listed here.
    /// </summary>
    public static IReadOnlyList<CliApiRoute> Curated { get; } =
    [
        new("app-list", "GET", Applications, "app list"),
        new("app-get", "GET", ApplicationById, "app get"),
        new("env-list", "GET", Environments, "env list"),
        new("env-get", "GET", EnvironmentByName, "env get"),
        new("feature-list", "GET", Features, "feature list"),
        new("feature-get", "GET", FeatureByKey, "feature get"),
        new("feature-create", "POST", Features, "feature create"),
        new("feature-update", "PUT", FeatureByKey, "feature update"),
        new("feature-update-environment", "PUT", FeatureEnvironment, "feature update-environment"),
        new("release-list", "GET", Releases, "release list"),
        new("release-get", "GET", ReleaseById, "release get"),
        new("release-create", "POST", Releases, "release create"),
        new("release-associate-build", "POST", AssociateBuild, "release associate-build"),
    ];

    public static string Application(string applicationId) =>
        $"/applications/{Seg(applicationId)}";

    public static string EnvironmentList(string applicationId) =>
        $"/applications/{Seg(applicationId)}/environments";

    public static string Environment(string applicationId, string environmentName) =>
        $"/applications/{Seg(applicationId)}/environments/{Seg(environmentName)}";

    public static string FeatureList(string applicationId) =>
        $"/applications/{Seg(applicationId)}/features";

    public static string Feature(string applicationId, string featureKey) =>
        $"/applications/{Seg(applicationId)}/features/{Seg(featureKey)}";

    public static string FeatureInEnvironment(string applicationId, string environment, string featureKey) =>
        $"/applications/{Seg(applicationId)}/environments/{Seg(environment)}/features/{Seg(featureKey)}";

    public static string Release(string releaseId) =>
        $"/releases/{Seg(releaseId)}";

    private static string Seg(string value) => Uri.EscapeDataString(value);
}

/// <summary>
/// One curated management-API route the CLI exercises.
/// </summary>
public sealed record CliApiRoute(string Id, string Method, string PathTemplate, string Command);
