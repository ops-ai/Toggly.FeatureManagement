namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Masks Toggly app keys for logs and debug surfaces.
    /// </summary>
    internal static class AppKeySanitizer
    {
        /// <summary>
        /// Returns a masked app key (last 6 characters when long enough).
        /// </summary>
        public static string Sanitize(string? appKey)
        {
            if (string.IsNullOrEmpty(appKey))
                return "***";

            return appKey.Length > 6 ? $"***{appKey[^6..]}" : "***";
        }
    }
}
