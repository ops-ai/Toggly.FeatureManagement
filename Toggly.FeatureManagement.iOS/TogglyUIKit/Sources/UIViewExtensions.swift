#if canImport(UIKit)
import UIKit
import TogglyCore

extension UIView {
    private struct AssociatedKeys {
        static var featureFlagKey = "toggly_featureFlagKey"
        static var featureFlagUnsubscribe = "toggly_featureFlagUnsubscribe"
    }

    /// The feature flag key associated with this view.
    public var featureFlagKey: String? {
        get { objc_getAssociatedObject(self, &AssociatedKeys.featureFlagKey) as? String }
        set { objc_setAssociatedObject(self, &AssociatedKeys.featureFlagKey, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    private var featureFlagUnsubscribe: (() -> Void)? {
        get { objc_getAssociatedObject(self, &AssociatedKeys.featureFlagUnsubscribe) as? () -> Void }
        set { objc_setAssociatedObject(self, &AssociatedKeys.featureFlagUnsubscribe, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    /// Bind this view's visibility to a feature flag.
    /// The view will be hidden when the feature is disabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - hideWhenEnabled: If true, hide when enabled instead of when disabled.
    public func bindToFeatureFlag(
        _ key: String,
        service: TogglyService? = nil,
        hideWhenEnabled: Bool = false
    ) {
        // Clean up existing binding
        featureFlagUnsubscribe?()

        featureFlagKey = key
        let toggly = service ?? Toggly.shared

        Task { @MainActor in
            // Set initial state
            let isEnabled = await toggly.isFeatureOn(key)
            self.isHidden = hideWhenEnabled ? isEnabled : !isEnabled

            // Subscribe to changes
            let unsubscribe = await toggly.addStateChangeHandler { [weak self] featureKey, _, newValue in
                guard let self = self, featureKey == key else { return }
                Task { @MainActor in
                    let enabled = newValue ?? false
                    self.isHidden = hideWhenEnabled ? enabled : !enabled
                }
            }
            self.featureFlagUnsubscribe = unsubscribe
        }
    }

    /// Remove the feature flag binding from this view.
    public func unbindFromFeatureFlag() {
        featureFlagUnsubscribe?()
        featureFlagUnsubscribe = nil
        featureFlagKey = nil
    }
}

extension UIControl {
    /// Bind this control's enabled state to a feature flag.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - disableWhenEnabled: If true, disable when the feature is enabled.
    public func bindEnabledToFeatureFlag(
        _ key: String,
        service: TogglyService? = nil,
        disableWhenEnabled: Bool = false
    ) {
        let toggly = service ?? Toggly.shared

        Task { @MainActor in
            let isEnabled = await toggly.isFeatureOn(key)
            self.isEnabled = disableWhenEnabled ? !isEnabled : isEnabled

            _ = await toggly.addStateChangeHandler { [weak self] featureKey, _, newValue in
                guard let self = self, featureKey == key else { return }
                Task { @MainActor in
                    let enabled = newValue ?? false
                    self.isEnabled = disableWhenEnabled ? !enabled : enabled
                }
            }
        }
    }
}
#endif
