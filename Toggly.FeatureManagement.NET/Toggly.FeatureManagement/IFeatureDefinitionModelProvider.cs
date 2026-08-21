using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Provides raw Toggly feature definition models (including ContextProperty filters).
    /// </summary>
    public interface IFeatureDefinitionModelProvider
    {
        bool TryGetFeatureModel(string featureKey, out FeatureDefinitionModel? definition);
    }
}
