import SwiftUI
import TogglyCore

/// A view modifier that conditionally shows content based on a feature flag.
public struct FeatureFlagViewModifier: ViewModifier {
    @FeatureFlag private var isEnabled: Bool
    private let showWhenDisabled: Bool

    init(key: String, showWhenDisabled: Bool = false, service: TogglyService? = nil) {
        self._isEnabled = FeatureFlag(key, service: service)
        self.showWhenDisabled = showWhenDisabled
    }

    public func body(content: Content) -> some View {
        if showWhenDisabled {
            if !isEnabled {
                content
            }
        } else {
            if isEnabled {
                content
            }
        }
    }
}

/// A view modifier that swaps content based on a feature flag.
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
    /// Show this view only when the feature flag is enabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    /// - Returns: A view that is shown only when the feature is enabled.
    @ViewBuilder
    public func featureFlag(
        _ key: String,
        service: TogglyService? = nil
    ) -> some View {
        modifier(FeatureFlagViewModifier(key: key, service: service))
    }

    /// Show this view only when the feature flag is disabled.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - service: The Toggly service to use.
    /// - Returns: A view that is shown only when the feature is disabled.
    @ViewBuilder
    public func featureFlagOff(
        _ key: String,
        service: TogglyService? = nil
    ) -> some View {
        modifier(FeatureFlagViewModifier(key: key, showWhenDisabled: true, service: service))
    }

    /// Show this view when the feature is enabled, otherwise show alternate content.
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
