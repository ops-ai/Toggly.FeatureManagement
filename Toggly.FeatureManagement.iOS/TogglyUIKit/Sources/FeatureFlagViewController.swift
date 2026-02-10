#if canImport(UIKit)
import UIKit
import TogglyCore

/// A view controller that manages feature flag state and updates.
///
/// Subclass this to create view controllers that respond to feature flag changes.
///
/// Usage:
/// ```swift
/// class MyViewController: FeatureFlagViewController {
///     override func viewDidLoad() {
///         super.viewDidLoad()
///         observeFeature("new-feature")
///     }
///
///     override func featureFlagDidChange(_ key: String, isEnabled: Bool) {
///         updateUI(for: key, isEnabled: isEnabled)
///     }
/// }
/// ```
open class FeatureFlagViewController: UIViewController {
    private var featureObservers: [String: Bool] = [:]
    private var unsubscribes: [() -> Void] = []
    private var service: TogglyService?

    /// The Toggly service used by this view controller.
    public var togglyService: TogglyService {
        get { service ?? Toggly.shared }
        set { service = newValue }
    }

    /// Start observing a feature flag.
    /// - Parameter key: The feature flag key to observe.
    public func observeFeature(_ key: String) {
        Task { @MainActor in
            let isEnabled = await togglyService.isFeatureOn(key)
            featureObservers[key] = isEnabled
            featureFlagDidChange(key, isEnabled: isEnabled)

            let unsubscribe = await togglyService.addStateChangeHandler { [weak self] featureKey, _, newValue in
                guard let self = self, featureKey == key else { return }
                Task { @MainActor in
                    let enabled = newValue ?? false
                    self.featureObservers[key] = enabled
                    self.featureFlagDidChange(key, isEnabled: enabled)
                }
            }
            unsubscribes.append(unsubscribe)
        }
    }

    /// Stop observing a feature flag.
    /// - Parameter key: The feature flag key to stop observing.
    public func stopObservingFeature(_ key: String) {
        featureObservers.removeValue(forKey: key)
    }

    /// Check if a feature is currently enabled.
    /// - Parameter key: The feature flag key.
    /// - Returns: Whether the feature is enabled.
    public func isFeatureEnabled(_ key: String) -> Bool {
        return featureObservers[key] ?? false
    }

    /// Called when a feature flag changes.
    /// Override this method to respond to feature flag changes.
    /// - Parameters:
    ///   - key: The feature flag key that changed.
    ///   - isEnabled: Whether the feature is now enabled.
    open func featureFlagDidChange(_ key: String, isEnabled: Bool) {
        // Override in subclass
    }

    deinit {
        unsubscribes.forEach { $0() }
    }
}
#endif
