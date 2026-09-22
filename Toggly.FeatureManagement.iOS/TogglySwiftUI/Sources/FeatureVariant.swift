import SwiftUI
import TogglyCore

/// A property wrapper that provides reactive access to a server-evaluated
/// feature variant assignment. Requires `TogglyConfig.enableVariants == true`.
///
/// Usage:
/// ```swift
/// struct MyView: View {
///     @FeatureVariant("checkout-experiment") var variant
///
///     var body: some View {
///         switch variant?.name {
///         case "Treatment":
///             TreatmentView()
///         default:
///             ControlView()
///         }
///     }
/// }
/// ```
@propertyWrapper
public struct FeatureVariant: DynamicProperty {
    @StateObject private var observer: FeatureVariantObserver

    /// The current variant assignment, or `nil` when none is assigned.
    public var wrappedValue: VariantResult? {
        observer.variant
    }

    /// Creates a feature variant property wrapper.
    /// - Parameters:
    ///   - key: The feature key.
    ///   - service: The Toggly service to use. Defaults to the shared instance.
    public init(_ key: String, service: TogglyService? = nil) {
        _observer = StateObject(wrappedValue: FeatureVariantObserver(key: key, service: service))
    }
}

/// An observable object that tracks a feature variant assignment.
@MainActor
public final class FeatureVariantObserver: ObservableObject {
    /// The current variant assignment, or `nil` when none is assigned.
    @Published public private(set) var variant: VariantResult?

    private let key: String
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?

    init(key: String, service: TogglyService?) {
        self.key = key
        self.service = service

        Task {
            await self.setup()
        }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly = toggly else {
            variant = nil
            return
        }

        variant = await toggly.getVariant(key)

        // A variant name can change (e.g. Control -> Treatment) while the
        // feature's boolean `enabled` stays the same, so a per-key boolean
        // state-change handler cannot be relied on here. Re-read the variant
        // after any refresh cycle (periodic, identity change, live update).
        unsubscribe = await toggly.on { [weak self] event in
            guard let self = self else { return }
            switch event {
            case .refreshed, .identityChanged:
                Task { @MainActor in
                    guard let toggly = self.service ?? (Toggly.isConfigured ? Toggly.shared : nil) else { return }
                    self.variant = await toggly.getVariant(self.key)
                }
            default:
                break
            }
        }
    }

    deinit {
        unsubscribe?()
    }
}
