namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Service to manage feature state
    /// </summary>
    public interface ISecureFeatureProvider
    {
        /// <summary>
        /// Check if a feature requires a security check
        /// </summary>
        /// <param name="featureKey"></param>
        /// <returns></returns>
        bool IsFeatureSecured(string featureKey);
    }
}
