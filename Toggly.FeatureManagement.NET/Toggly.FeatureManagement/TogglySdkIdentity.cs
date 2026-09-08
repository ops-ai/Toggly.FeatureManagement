using System.Reflection;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Canonical SDK identity for User-Agent / gRPC <c>UA</c> metadata.
    /// Must match platform <c>SdkUserAgentParser</c>: <c>toggly-dotnet/{version}</c>.
    /// </summary>
    public static class TogglySdkIdentity
    {
        /// <summary>SDK id segment in the User-Agent.</summary>
        public const string SdkId = "dotnet";

        /// <summary>
        /// Package semver from assembly informational/file/name version
        /// (embedded from MSBuild <c>$(Version)</c>). Never empty.
        /// </summary>
        public static string Version { get; } = ResolveVersion();

        /// <summary>Full User-Agent: <c>toggly-dotnet/{Version}</c>.</summary>
        public static string UserAgent { get; } = $"toggly-{SdkId}/{Version}";

        private static string ResolveVersion() => ResolveVersion(typeof(TogglySdkIdentity).Assembly);

        /// <summary>Resolves a package version from assembly attributes (testable).</summary>
        internal static string ResolveVersion(Assembly assembly)
        {
            var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (TryNormalize(informational, out var fromInfo))
                return fromInfo;

            var file = assembly.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version;
            if (TryNormalize(file, out var fromFile))
                return fromFile;

            var name = assembly.GetName().Version;
            if (name != null && !(name.Major == 0 && name.Minor == 0 && name.Build == 0 && name.Revision == 0))
            {
                // Prefer 3-part semver when revision is 0 (MSBuild $(Version).0).
                if (name.Revision <= 0)
                    return $"{name.Major}.{name.Minor}.{name.Build}";
                return name.ToString();
            }

            return "unknown";
        }

        /// <summary>Normalizes raw version attribute text (testable).</summary>
        internal static bool TryNormalize(string? raw, out string version)
        {
            version = "";
            if (string.IsNullOrWhiteSpace(raw))
                return false;

            // Strip SourceLink/CI metadata: "3.6.6+abc" → "3.6.6"
            var plus = raw.IndexOf('+');
            if (plus >= 0)
                raw = raw[..plus];

            raw = raw.Trim();
            if (raw.Length == 0 || raw == "0.0.0.0")
                return false;

            version = raw;
            return true;
        }
    }
}
