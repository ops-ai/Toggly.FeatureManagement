namespace Toggly.FeatureManagement
{
    public interface IUsageStatsDebug
    {
        /// <summary>
        /// Debug info
        /// </summary>
        /// <returns></returns>
        UsageStatsDebugInfo GetDebugInfo();
    }
}
