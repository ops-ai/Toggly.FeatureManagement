namespace Toggly.FeatureManagement
{
    public interface IFeatureProviderDebug
    {
        /// <summary>
        /// Debug info
        /// </summary>
        /// <returns></returns>
        FeatureProviderDebugInfo GetDebugInfo();
    }
}
