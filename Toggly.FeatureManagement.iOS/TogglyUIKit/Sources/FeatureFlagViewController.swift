#if canImport(UIKit) && !os(watchOS)
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
    private var featureObservers: [String: FeatureCheckSnapshot] = [:]
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
            let owner = togglyService
            let snapshot = await owner.captureFeatureCheck(key)
            guard togglyService === owner else { return }
            await owner.recordCheck(snapshot)
            featureObservers[key] = snapshot
            featureFlagDidChange(key, isEnabled: snapshot.enabled)

            let unsubscribe = await owner.addFeatureCheckHandler { [weak self, weak owner] snapshot in
                guard let self = self, let owner, snapshot.key == key else { return }
                Task { @MainActor in
                    guard self.togglyService === owner else { return }
                    await owner.recordCheck(snapshot)
                    self.featureObservers[key] = snapshot
                    self.featureFlagDidChange(key, isEnabled: snapshot.enabled)
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
        guard let snapshot = featureObservers[key] else { return false }
        if let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil) {
            Task { await toggly.recordCheck(snapshot) }
        }
        return snapshot.enabled
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
