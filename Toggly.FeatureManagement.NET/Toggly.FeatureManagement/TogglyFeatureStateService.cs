using System;
using System.Collections.Concurrent;

namespace Toggly.FeatureManagement
{
    public class TogglyFeatureStateService : IFeatureStateInternalService
    {
        private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, Action>> _onSubscribers = new ConcurrentDictionary<string, ConcurrentDictionary<Guid, Action>>();
        private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, Action>> _offSubscribers = new ConcurrentDictionary<string, ConcurrentDictionary<Guid, Action>>();
        private readonly ConcurrentDictionary<string, bool> _featureStates = new ConcurrentDictionary<string, bool>();

        public Guid WhenFeatureTurnsOn(object featureKey, Action action)
        {
            var type = featureKey.GetType();

            if (!type.IsEnum)
                throw new ArgumentException("The provided features must be enums.", nameof(featureKey));

            return WhenFeatureTurnsOn(Enum.GetName(featureKey.GetType(), featureKey), action);
        }

        public Guid WhenFeatureTurnsOn(string featureKey, Action action)
        {
            if (!_onSubscribers.ContainsKey(featureKey))
                _onSubscribers.TryAdd(featureKey, new ConcurrentDictionary<Guid, Action>());

            var id = Guid.NewGuid();
            _onSubscribers[featureKey].TryAdd(id, action);
            return id;
        }

        public Guid WhenFeatureTurnsOff(object featureKey, Action action)
        {
            var type = featureKey.GetType();

            if (!type.IsEnum)
                throw new ArgumentException("The provided features must be enums.", nameof(featureKey));

            return WhenFeatureTurnsOff(Enum.GetName(featureKey.GetType(), featureKey), action);
        }

        public Guid WhenFeatureTurnsOff(string featureKey, Action action)
        {
            if (!_offSubscribers.ContainsKey(featureKey))
                _offSubscribers.TryAdd(featureKey, new ConcurrentDictionary<Guid, Action>());

            var id = Guid.NewGuid();
            _offSubscribers[featureKey].TryAdd(id, action);
            return id;
        }

        public bool UnregisterFeatureStateChange(string featureKey, Guid id)
        {
            if (!_offSubscribers.ContainsKey(featureKey))
                return false;

            return _offSubscribers[featureKey].TryRemove(id, out _);
        }

        public void UpdateFeatureState(string featureKey, bool state)
        {
            if (!_featureStates.ContainsKey(featureKey))
                _featureStates.TryAdd(featureKey, state);
            else
            {
                if (_featureStates[featureKey] == state)
                    return;

                _featureStates[featureKey] = state;
            }

            if (state && _onSubscribers.ContainsKey(featureKey))
                foreach (var subscriber in _onSubscribers[featureKey])
                    subscriber.Value();
            else if (!state && _offSubscribers.ContainsKey(featureKey))
                foreach (var subscriber in _offSubscribers[featureKey])
                    subscriber.Value();
        }
    }
}
