import SwiftUI
import TogglyCore

/// A view modifier that conditionally shows content based on a feature flag.
public struct FeatureFlagViewModifier: ViewModifier {
    @FeatureFlag private var isEnabled: Bool

    init(
        key: String,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil,
        service: TogglyService? = nil
    ) {
        self._isEnabled = FeatureFlag(
            key,
            negate: negate,
            context: context,
            kind: kind,
            service: service
        )
    }

    public func body(content: Content) -> some View {
        if isEnabled {
            content
        }
    }
}

/// A view modifier that swaps content based on a feature flag (Variant-style dual slot).
public struct FeatureFlagSwapModifier<AlternateContent: View>: ViewModifier {
    @FeatureFlag private var isEnabled: Bool
    private let alternateContent: AlternateContent

    init(
        key: String,
        service: TogglyService? = nil,
        @ViewBuilder alternate: () -> AlternateContent
    ) {
        self._isEnabled = FeatureFlag(key, service: service)
        self.alternateContent = alternate()
    }

    public func body(content: Content) -> some View {
        if isEnabled {
            content
        } else {
            alternateContent
        }
    }
}

// MARK: - View Extensions

extension View {
    /// Show this view only when the feature flag check passes.
    ///
    /// Use `negate: true` for the preferred off path.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - negate: Whether to invert the check.
    ///   - context: Optional per-evaluation entity context.
    ///   - kind: Optional kind for `registerContext` mapper lookup.
    ///   - service: The Toggly service to use.
    /// - Returns: A view that is shown only when the check passes.
    @ViewBuilder
    public func featureFlag(
        _ key: String,
        negate: Bool = false,
        context: Any? = nil,
        kind: String? = nil,
        service: TogglyService? = nil
    ) -> some View {
        modifier(FeatureFlagViewModifier(
            key: key,
            negate: negate,
            context: context,
            kind: kind,
            service: service
        ))
    }

    /// Show this view only when the feature flag is disabled.
    ///
    /// Prefer ``featureFlag(_:negate:context:kind:service:)`` with `negate: true`.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    /// - Returns: A view that is shown only when the feature is disabled.
    @available(*, deprecated, message: "Use featureFlag(_:negate: true) instead")
    @ViewBuilder
    public func featureFlagOff(
        _ key: String,
        service: TogglyService? = nil
    ) -> some View {
        modifier(FeatureFlagViewModifier(key: key, negate: true, service: service))
    }

    /// Show this view when the feature is enabled, otherwise show alternate content.
    ///
    /// Variant-style dual slot — not the primary Off API. Prefer
    /// ``featureFlag(_:negate:context:kind:service:)`` with `negate: true` for off-only UI.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    ///   - alternate: The alternate content to show when disabled.
    /// - Returns: A view that switches between content based on the feature flag.
    @ViewBuilder
    public func featureFlag<Alternate: View>(
        _ key: String,
        service: TogglyService? = nil,
        @ViewBuilder else alternate: () -> Alternate
    ) -> some View {
        modifier(FeatureFlagSwapModifier(key: key, service: service, alternate: alternate))
    }
}
