#if canImport(UIKit) && !os(watchOS)
import UIKit
import TogglyCore

// UIKit owns and mutates bindings on the main actor. Handlers only inspect them
// after hopping back to that actor; weak captures avoid service ownership cycles.
final class FeatureFlagBinding: @unchecked Sendable {
    var active = true
    var unsubscribe: (() -> Void)?

    func cancel() {
        active = false
        unsubscribe?()
        unsubscribe = nil
    }

    deinit { unsubscribe?() }
}

extension UIView {
    private struct AssociatedKeys {
        static var featureFlagKey = "toggly_featureFlagKey"
        static var visibilityBinding = "toggly_visibilityBinding"
        static var enabledBinding = "toggly_enabledBinding"
    }

    /// The feature flag key associated with this view's visibility.
    public var featureFlagKey: String? {
        get { objc_getAssociatedObject(self, &AssociatedKeys.featureFlagKey) as? String }
        set { objc_setAssociatedObject(self, &AssociatedKeys.featureFlagKey, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    private var visibilityBinding: FeatureFlagBinding? {
        get { objc_getAssociatedObject(self, &AssociatedKeys.visibilityBinding) as? FeatureFlagBinding }
        set { objc_setAssociatedObject(self, &AssociatedKeys.visibilityBinding, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    fileprivate var enabledBinding: FeatureFlagBinding? {
        get { objc_getAssociatedObject(self, &AssociatedKeys.enabledBinding) as? FeatureFlagBinding }
        set { objc_setAssociatedObject(self, &AssociatedKeys.enabledBinding, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    /// Bind this view's visibility to a feature flag, replacing its previous visibility binding.
    public func bindToFeatureFlag(
        _ key: String,
        service: TogglyService? = nil,
        hideWhenEnabled: Bool = false
    ) {
        visibilityBinding?.cancel()
        let binding = FeatureFlagBinding()
        visibilityBinding = binding
        featureFlagKey = key
        let owner = service ?? Toggly.shared
        Task { @MainActor [weak self] in
            guard let self, self.visibilityBinding === binding, binding.active else { return }
            let snapshot = await owner.captureFeatureCheck(key)
            guard self.visibilityBinding === binding, binding.active else { return }
            self.isHidden = hideWhenEnabled ? snapshot.enabled : !snapshot.enabled
            await owner.recordCheck(snapshot)
            guard self.visibilityBinding === binding, binding.active else { return }
            let unsubscribe = await owner.addFeatureCheckHandler { [weak self, weak owner, weak binding] snapshot in
                guard let owner, snapshot.key == key else { return }
                Task { @MainActor [weak self, weak binding] in
                    guard let self, let binding, binding.active, self.visibilityBinding === binding else { return }
                    self.isHidden = hideWhenEnabled ? snapshot.enabled : !snapshot.enabled
                    await owner.recordCheck(snapshot)
                }
            }
            guard self.visibilityBinding === binding, binding.active else { unsubscribe(); return }
            binding.unsubscribe = unsubscribe
        }
    }

    /// Remove visibility and control-enabled feature flag bindings.
    public func unbindFromFeatureFlag() {
        visibilityBinding?.cancel()
        visibilityBinding = nil
        enabledBinding?.cancel()
        enabledBinding = nil
        featureFlagKey = nil
    }
}

extension UIControl {
    /// Bind this control's enabled state, replacing its previous enabled binding.
    public func bindEnabledToFeatureFlag(
        _ key: String,
        service: TogglyService? = nil,
        disableWhenEnabled: Bool = false
    ) {
        unbindEnabledFromFeatureFlag()
        let binding = FeatureFlagBinding()
        enabledBinding = binding
        let owner = service ?? Toggly.shared
        Task { @MainActor [weak self] in
            guard let self, self.enabledBinding === binding, binding.active else { return }
            let snapshot = await owner.captureFeatureCheck(key)
            guard self.enabledBinding === binding, binding.active else { return }
            self.isEnabled = disableWhenEnabled ? !snapshot.enabled : snapshot.enabled
            await owner.recordCheck(snapshot)
            guard self.enabledBinding === binding, binding.active else { return }
            let unsubscribe = await owner.addFeatureCheckHandler { [weak self, weak owner, weak binding] snapshot in
                guard let owner, snapshot.key == key else { return }
                Task { @MainActor [weak self, weak binding] in
                    guard let self, let binding, binding.active, self.enabledBinding === binding else { return }
                    self.isEnabled = disableWhenEnabled ? !snapshot.enabled : snapshot.enabled
                    await owner.recordCheck(snapshot)
                }
            }
            guard self.enabledBinding === binding, binding.active else { unsubscribe(); return }
            binding.unsubscribe = unsubscribe
        }
    }

    /// Remove only the enabled-state binding, preserving any visibility binding.
    public func unbindEnabledFromFeatureFlag() {
        enabledBinding?.cancel()
        enabledBinding = nil
    }
}
#endif
