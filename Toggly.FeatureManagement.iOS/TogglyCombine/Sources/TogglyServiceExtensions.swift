import Combine
import TogglyCore

extension TogglyService {
    /// Create a publisher for a feature flag.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - defaultValue: The default value to use if the flag is not found.
    /// - Returns: A publisher that emits the feature flag state.
    public func featureFlagPublisher(
        _ key: String,
        defaultValue: Bool = false
    ) -> FeatureFlagPublisher {
        FeatureFlagPublisher(key, defaultValue: defaultValue, service: self)
    }

    /// Create a publisher for a feature gate.
    /// - Parameters:
    ///   - keys: The feature flag keys to evaluate.
    ///   - requirement: Whether all or any flags must be enabled.
    ///   - negate: Whether to negate the result.
    /// - Returns: A publisher that emits the gate evaluation result.
    public func featureGatePublisher(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false
    ) -> FeatureGatePublisher {
        FeatureGatePublisher(keys, requirement: requirement, negate: negate, service: self)
    }

    /// Create a publisher for Toggly events.
    /// - Returns: A publisher that emits Toggly events.
    public func eventPublisher() -> TogglyEventPublisher {
        TogglyEventPublisher(service: self)
    }

    /// Create a publisher for feature change events.
    /// - Parameter featureKey: Optional key to filter events.
    /// - Returns: A publisher that emits feature change events.
    public func featureChangedPublisher(featureKey: String? = nil) -> FeatureChangedPublisher {
        FeatureChangedPublisher(featureKey: featureKey, service: self)
    }
}

/// Convenience publishers using the shared Toggly instance.
public enum TogglyPublishers {
    /// Create a publisher for a feature flag using the shared instance.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - defaultValue: The default value to use if the flag is not found.
    /// - Returns: A publisher that emits the feature flag state.
    public static func featureFlag(
        _ key: String,
        defaultValue: Bool = false
    ) -> FeatureFlagPublisher {
        FeatureFlagPublisher(key, defaultValue: defaultValue)
    }

    /// Create a publisher for a feature gate using the shared instance.
    /// - Parameters:
    ///   - keys: The feature flag keys to evaluate.
    ///   - requirement: Whether all or any flags must be enabled.
    ///   - negate: Whether to negate the result.
    /// - Returns: A publisher that emits the gate evaluation result.
    public static func featureGate(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false
    ) -> FeatureGatePublisher {
        FeatureGatePublisher(keys, requirement: requirement, negate: negate)
    }

    /// Create a publisher for Toggly events using the shared instance.
    /// - Returns: A publisher that emits Toggly events.
    public static func events() -> TogglyEventPublisher {
        TogglyEventPublisher()
    }

    /// Create a publisher for feature change events using the shared instance.
    /// - Parameter featureKey: Optional key to filter events.
    /// - Returns: A publisher that emits feature change events.
    public static func featureChanged(featureKey: String? = nil) -> FeatureChangedPublisher {
        FeatureChangedPublisher(featureKey: featureKey)
    }
}
