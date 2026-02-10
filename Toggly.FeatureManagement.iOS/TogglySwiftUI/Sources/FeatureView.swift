import SwiftUI
import TogglyCore

/// A view that conditionally renders content based on a feature flag.
///
/// Usage:
/// ```swift
/// FeatureView("new-feature") {
///     NewFeatureView()
/// } else: {
///     LegacyView()
/// }
/// ```
public struct FeatureView<EnabledContent: View, DisabledContent: View>: View {
    @FeatureFlag private var isEnabled: Bool
    private let enabledContent: EnabledContent
    private let disabledContent: DisabledContent

    /// Creates a feature view with content for both enabled and disabled states.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - enabled: Content to show when the feature is enabled.
    ///   - disabled: Content to show when the feature is disabled.
    public init(
        _ key: String,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent,
        @ViewBuilder else disabled: () -> DisabledContent
    ) {
        self._isEnabled = FeatureFlag(key, service: service)
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
    /// Creates a feature view that only shows content when enabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - enabled: Content to show when the feature is enabled.
    public init(
        _ key: String,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent
    ) {
        self._isEnabled = FeatureFlag(key, service: service)
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
    /// - Parameters:
    ///   - keys: The feature flag keys to evaluate.
    ///   - requirement: Whether all or any flags must be enabled.
    ///   - negate: Whether to negate the result.
    ///   - service: The Toggly service to use.
    ///   - enabled: Content to show when the gate passes.
    ///   - disabled: Content to show when the gate fails.
    public init(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent,
        @ViewBuilder else disabled: () -> DisabledContent
    ) {
        self._isEnabled = FeatureGate(keys, requirement: requirement, negate: negate, service: service)
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
    public init(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        service: TogglyService? = nil,
        @ViewBuilder enabled: () -> EnabledContent
    ) {
        self._isEnabled = FeatureGate(keys, requirement: requirement, negate: negate, service: service)
        self.enabledContent = enabled()
        self.disabledContent = EmptyView()
    }
}
