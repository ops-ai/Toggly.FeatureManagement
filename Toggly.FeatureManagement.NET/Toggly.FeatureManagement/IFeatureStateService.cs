using System;

namespace Toggly.FeatureManagement
{
    public interface IFeatureStateService
    {
        Guid WhenFeatureTurnsOn(string featureKey, Action action);

        Guid WhenFeatureTurnsOn(object featureKey, Action action);

        Guid WhenFeatureTurnsOff(string featureKey, Action action);

        Guid WhenFeatureTurnsOff(object featureKey, Action action);

        bool UnregisterFeatureStateChange(string featureKey, Guid id);
    }

    internal interface IFeatureStateInternalService : IFeatureStateService
    {
        void UpdateFeatureState(string featureKey, bool state);
    }
}
