#if canImport(UIKit)
import UIKit
import TogglyCore

/// Async/await utilities for feature flags in UIKit.
public enum FeatureFlagAsync {
    /// Check if a feature is enabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    /// - Returns: Whether the feature is enabled.
    public static func isEnabled(
        _ key: String,
        service: TogglyService? = nil
    ) async -> Bool {
        let toggly = service ?? Toggly.shared
        return await toggly.isFeatureOn(key)
    }

    /// Check if a feature is disabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    /// - Returns: Whether the feature is disabled.
    public static func isDisabled(
        _ key: String,
        service: TogglyService? = nil
    ) async -> Bool {
        let toggly = service ?? Toggly.shared
        return await toggly.isFeatureOff(key)
    }

    /// Evaluate a feature gate with multiple keys.
    /// - Parameters:
    ///   - keys: The feature flag keys to evaluate.
    ///   - requirement: Whether all or any flags must be enabled.
    ///   - negate: Whether to negate the result.
    ///   - service: The Toggly service to use.
    /// - Returns: The evaluation result.
    public static func evaluate(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        service: TogglyService? = nil
    ) async -> Bool {
        let toggly = service ?? Toggly.shared
        return await toggly.evaluateFeatureGate(
            featureKeys: keys,
            requirement: requirement,
            negate: negate
        )
    }

    /// Execute a closure if a feature is enabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - action: The action to execute if enabled.
    /// - Returns: The result of the action, or nil if not executed.
    @discardableResult
    public static func ifEnabled<T>(
        _ key: String,
        service: TogglyService? = nil,
        action: () async throws -> T
    ) async rethrows -> T? {
        if await isEnabled(key, service: service) {
            return try await action()
        }
        return nil
    }

    /// Execute a closure if a feature is disabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - action: The action to execute if disabled.
    /// - Returns: The result of the action, or nil if not executed.
    @discardableResult
    public static func ifDisabled<T>(
        _ key: String,
        service: TogglyService? = nil,
        action: () async throws -> T
    ) async rethrows -> T? {
        if await isDisabled(key, service: service) {
            return try await action()
        }
        return nil
    }

    /// Execute one of two closures based on feature flag state.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - enabled: Action to execute if enabled.
    ///   - disabled: Action to execute if disabled.
    /// - Returns: The result of the executed action.
    public static func choose<T>(
        _ key: String,
        service: TogglyService? = nil,
        enabled: () async throws -> T,
        disabled: () async throws -> T
    ) async rethrows -> T {
        if await isEnabled(key, service: service) {
            return try await enabled()
        } else {
            return try await disabled()
        }
    }
}
#endif
