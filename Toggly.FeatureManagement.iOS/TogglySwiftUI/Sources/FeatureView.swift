import SwiftUI
import TogglyCore

/// A view that conditionally renders content based on a feature flag.
///
/// Prefer `negate: true` for the off path:
/// ```swift
/// FeatureView("maintenance-mode", negate: true) {
///     MainContent()
/// }
/// ```
///
/// Dual-slot `else:` is a Variant-style layout (on and off in one call), not the
/// primary Off API:
/// ```swift
/// FeatureView("new-feature") {
///     NewFeatureView()
/// } else: {
///     LegacyView()
/// }
/// ```
public struct FeatureView<EnabledContent: View, DisabledContent: View>: View {
    @FeatureGate private var isEnabled: Bool
    private let enabledContent: EnabledContent
    private let disabledContent: DisabledContent

    /// Creates a feature view with content for both enabled and disabled states.
    ///
    /// The dual-slot `else:` branch is Variant-style. For the primary off path,
    /// prefer `FeatureView(_:negate:)` with a single content builder.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - negate: Whether to invert the check before choosing a slot.
    ///   - context: Optional per-evaluation entity context.
    ///   - kind: Optional kind for `registerContext` mapper lookup.
    ///   - service: The Toggly service to use.
    ///   - enabled: Content to show when the (possibly negated) check passes.
    ///   - disabled: Content to show when the check fails (Variant-style dual slot).
    public init(
        _ key: String,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent,
        @ViewBuilder else disabled: () -> DisabledContent
    ) {
        self._isEnabled = FeatureGate(
            [key],
            requirement: .all,
            negate: negate,
            context: context,
            kind: kind,
            service: service
        )
        self.enabledContent = enabled()
        self.disabledContent = disabled()
    }

    public var body: some View {
        if isEnabled {
            enabledContent
        } else {
            disabledContent
        }
    }
}

extension FeatureView where DisabledContent == EmptyView {
    /// Creates a feature view that only shows content when the check passes.
    ///
    /// Use `negate: true` to show content when the feature is off.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - negate: Whether to invert the check (preferred off path).
    ///   - context: Optional per-evaluation entity context.
    ///   - kind: Optional kind for `registerContext` mapper lookup.
    ///   - service: The Toggly service to use.
    ///   - enabled: Content to show when the check passes.
    public init(
        _ key: String,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent
    ) {
        self._isEnabled = FeatureGate(
            [key],
            requirement: .all,
            negate: negate,
            context: context,
            kind: kind,
            service: service
        )
        self.enabledContent = enabled()
        self.disabledContent = EmptyView()
    }
}

/// A view that conditionally renders content based on multiple feature flags.
public struct FeatureGateView<EnabledContent: View, DisabledContent: View>: View {
    @FeatureGate private var isEnabled: Bool
    private let enabledContent: EnabledContent
    private let disabledContent: DisabledContent

    /// Creates a feature gate view.
    ///
    /// Dual-slot `else:` is Variant-style. Prefer `negate: true` with a single
    /// content builder for the primary off path.
    /// - Parameters:
    ///   - keys: The feature flag keys to evaluate.
    ///   - requirement: Whether all or any flags must be enabled.
    ///   - negate: Whether to negate the result.
    ///   - context: Optional per-evaluation entity context.
    ///   - kind: Optional kind for `registerContext` mapper lookup.
    ///   - service: The Toggly service to use.
    ///   - enabled: Content to show when the gate passes.
    ///   - disabled: Content to show when the gate fails (Variant-style dual slot).
    public init(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent,
        @ViewBuilder else disabled: () -> DisabledContent
    ) {
        self._isEnabled = FeatureGate(
            keys,
            requirement: requirement,
            negate: negate,
            context: context,
            kind: kind,
            service: service
        )
        self.enabledContent = enabled()
        self.disabledContent = disabled()
    }

    public var body: some View {
        if isEnabled {
            enabledContent
        } else {
            disabledContent
        }
    }
}

extension FeatureGateView where DisabledContent == EmptyView {
    /// Creates a feature gate view that only shows content when the gate passes.
    ///
    /// Use `negate: true` for the preferred off path.
    public init(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent
    ) {
        self._isEnabled = FeatureGate(
            keys,
            requirement: requirement,
            negate: negate,
            context: context,
            kind: kind,
            service: service
        )
        self.enabledContent = enabled()
        self.disabledContent = EmptyView()
    }
}
