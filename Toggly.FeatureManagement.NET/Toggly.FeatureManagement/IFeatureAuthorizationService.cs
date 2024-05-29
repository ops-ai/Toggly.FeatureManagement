using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Service to manage feature state
    /// </summary>
    public interface IFeatureAuthorizationService
    {
        /// <summary>
        /// Check if a feature requires a security check
        /// </summary>
        /// <param name="featureKey"></param>
        /// <returns></returns>
        Task<bool> IsAllowedAsync(string featureKey);
    }
}
