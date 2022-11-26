using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IMetricsDebug
    {
        /// <summary>
        /// Debug info
        /// </summary>
        /// <returns></returns>
        MetricsDebugInfo GetDebugInfo();
    }
}
