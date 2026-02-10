import SwiftUI
import TogglyCore

/// A property wrapper that provides reactive access to a feature flag.
///
/// Usage:
/// ```swift
/// struct MyView: View {
///     @FeatureFlag("new-feature") var isNewFeatureEnabled
///
///     var body: some View {
///         if isNewFeatureEnabled {
///             NewFeatureView()
///         } else {
///             LegacyView()
///         }
///     }
/// }
/// ```
@propertyWrapper
public struct FeatureFlag: DynamicProperty {
    @StateObject private var observer: FeatureFlagObserver

    /// The current value of the feature flag.
    public var wrappedValue: Bool {
        observer.isEnabled
    }

    /// A binding to the feature flag value.
    public var projectedValue: Binding<Bool> {
        Binding(
            get: { observer.isEnabled },
            set: { _ in } // Read-only
        )
    }

    /// Creates a feature flag property wrapper.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - defaultValue: The default value if the flag is not found.
    ///   - service: The Toggly service to use. Defaults to the shared instance.
    public init(
        _ key: String,
        defaultValue: Bool = false,
        service: TogglyService? = nil
    ) {
        _observer = StateObject(wrappedValue: FeatureFlagObserver(
            key: key,
            defaultValue: defaultValue,
            service: service
        ))
    }
}

/// An observable object that tracks a feature flag's state.
@MainActor
public final class FeatureFlagObserver: ObservableObject {
    /// Whether the feature is enabled.
    @Published public private(set) var isEnabled: Bool

    private let key: String
    private let defaultValue: Bool
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?

    init(key: String, defaultValue: Bool, service: TogglyService?) {
        self.key = key
        self.defaultValue = defaultValue
        self.service = service
        self.isEnabled = defaultValue

        Task {
            await self.setup()
        }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly = toggly else {
            isEnabled = defaultValue
            return
        }

        // Get initial value
        isEnabled = await toggly.isFeatureOn(key)

        // Subscribe to changes
        unsubscribe = await toggly.addStateChangeHandler { [weak self] featureKey, _, newValue in
            guard let self = self, featureKey == self.key else { return }
            Task { @MainActor in
                self.isEnabled = newValue ?? self.defaultValue
            }
        }
    }

    deinit {
        unsubscribe?()
    }
}

/// A property wrapper for multiple feature flags with requirement logic.
@propertyWrapper
public struct FeatureGate: DynamicProperty {
    @StateObject private var observer: FeatureGateObserver

    /// The current value of the feature gate.
    public var wrappedValue: Bool {
        observer.isEnabled
    }

    /// Creates a feature gate property wrapper.
    /// - Parameters:
    ///   - keys: The feature flag keys to evaluate.
    ///   - requirement: Whether all or any flags must be enabled.
    ///   - negate: Whether to negate the result.
    ///   - service: The Toggly service to use.
    public init(
        _ keys: [String],
        requirement: FeatureRequirement = .all,
        negate: Bool = false,
        service: TogglyService? = nil
    ) {
        _observer = StateObject(wrappedValue: FeatureGateObserver(
            keys: keys,
            requirement: requirement,
            negate: negate,
            service: service
        ))
    }
}

/// An observable object that tracks a feature gate's state.
@MainActor
public final class FeatureGateObserver: ObservableObject {
    @Published public private(set) var isEnabled: Bool = false

    private let keys: [String]
    private let requirement: FeatureRequirement
    private let negate: Bool
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?

    init(
        keys: [String],
        requirement: FeatureRequirement,
        negate: Bool,
        service: TogglyService?
    ) {
        self.keys = keys
        self.requirement = requirement
        self.negate = negate
        self.service = service

        Task {
            await self.setup()
        }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly = toggly else {
            isEnabled = negate // Default to false, negated if needed
            return
        }

        // Get initial value
        isEnabled = await toggly.evaluateFeatureGate(
            featureKeys: keys,
            requirement: requirement,
            negate: negate
        )

        // Subscribe to changes
        unsubscribe = await toggly.addStateChangeHandler { [weak self] featureKey, _, _ in
            guard let self = self, self.keys.contains(featureKey) else { return }
            Task { @MainActor in
                guard let toggly = self.service ?? (Toggly.isConfigured ? Toggly.shared : nil) else { return }
                self.isEnabled = await toggly.evaluateFeatureGate(
                    featureKeys: self.keys,
                    requirement: self.requirement,
                    negate: self.negate
                )
            }
        }
    }

    deinit {
        unsubscribe?()
    }
}
