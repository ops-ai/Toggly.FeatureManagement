using System.Collections.Generic;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement
{
    public interface IFeatureExperimentProvider
    {
        List<string>? GetFeaturesForMetric(string metricKey);
    }
}
