using System;

namespace Toggly.FeatureManagement
{
    public interface IFeatureStateService
    {
        /// <summary>
        /// Register a callback to be executed when the feature turns on.
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <param name="action">Action to be executed</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid WhenFeatureTurnsOn(string featureKey, Action action);

        /// <summary>
        /// Register a callback to be executed when the feature turns on.
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <param name="action">Action to be executed</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid WhenFeatureTurnsOn(object featureKey, Action action);

        /// <summary>
        /// Register a callback to be executed when the feature turns off.
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <param name="action">Action to be executed</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid WhenFeatureTurnsOff(string featureKey, Action action);

        /// <summary>
        /// Register a callback to be executed when the feature turns off.
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <param name="action">Action to be executed</param>
        /// <returns>A unique id representing the callback, which can be used to unregister notifications</returns>
        Guid WhenFeatureTurnsOff(object featureKey, Action action);

        /// <summary>
        /// Unregister a callback.
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <param name="id">The ID of the callback</param>
        /// <returns>True if the handler was found and removed</returns>
        bool UnregisterFeatureStateChange(string featureKey, Guid id);
    }

    internal interface IFeatureStateInternalService : IFeatureStateService
    {
        /// <summary>
        /// Update the state of a feature
        /// </summary>
        /// <param name="featureKey">Feature key</param>
        /// <param name="state">The current state of the feature</param>
        void UpdateFeatureState(string featureKey, bool state);
    }
}
