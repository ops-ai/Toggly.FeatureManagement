import Combine
import TogglyCore

/// A publisher that emits the current state of a feature flag.
public struct FeatureFlagPublisher: Publisher {
    public typealias Output = Bool
    public typealias Failure = Never

    private let key: String
    private let service: TogglyService?
    private let defaultValue: Bool

    /// Creates a feature flag publisher.
    /// - Parameters:
    ///   - key: The feature flag key.
    ///   - defaultValue: The default value to emit initially.
    ///   - service: The Toggly service to use.
    public init(
        _ key: String,
        defaultValue: Bool = false,
        service: TogglyService? = nil
    ) {
        self.key = key
        self.defaultValue = defaultValue
        self.service = service
    }

    public func receive<S>(subscriber: S) where S: Subscriber, Failure == S.Failure, Output == S.Input {
        let subscription = FeatureFlagSubscription(
            subscriber: subscriber,
            key: key,
            defaultValue: defaultValue,
            service: service
        )
        subscriber.receive(subscription: subscription)
    }
}

private final class FeatureFlagSubscription<S: Subscriber>: Subscription where S.Input == Bool, S.Failure == Never {
    private var subscriber: S?
    private let key: String
    private let defaultValue: Bool
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none

    init(subscriber: S, key: String, defaultValue: Bool, service: TogglyService?) {
        self.subscriber = subscriber
        self.key = key
        self.defaultValue = defaultValue
        self.service = service
    }

    func request(_ demand: Subscribers.Demand) {
        self.demand += demand

        guard demand > 0 else { return }

        Task {
            await setup()
        }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly = toggly else {
            emit(defaultValue)
            return
        }

        // Emit initial value
        let isEnabled = await toggly.isFeatureOn(key)
        emit(isEnabled)

        // Subscribe to changes
        unsubscribe = await toggly.addStateChangeHandler { [weak self] featureKey, _, newValue in
            guard let self = self, featureKey == self.key else { return }
            self.emit(newValue ?? self.defaultValue)
        }
    }

    private func emit(_ value: Bool) {
        guard demand > 0, let subscriber = subscriber else { return }
        demand -= 1
        demand += subscriber.receive(value)
    }

    func cancel() {
        unsubscribe?()
        subscriber = nil
    }
}

/// A publisher that emits the result of a feature gate evaluation.
public struct FeatureGatePublisher: Publisher {
    public typealias Output = Bool
    public typealias Failure = Never

    private let keys: [String]
    private let requirement: FeatureRequirement
    private let negate: Bool
    private let service: TogglyService?

    /// Creates a feature gate publisher.
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
        self.keys = keys
        self.requirement = requirement
        self.negate = negate
        self.service = service
    }

    public func receive<S>(subscriber: S) where S: Subscriber, Failure == S.Failure, Output == S.Input {
        let subscription = FeatureGateSubscription(
            subscriber: subscriber,
            keys: keys,
            requirement: requirement,
            negate: negate,
            service: service
        )
        subscriber.receive(subscription: subscription)
    }
}

private final class FeatureGateSubscription<S: Subscriber>: Subscription where S.Input == Bool, S.Failure == Never {
    private var subscriber: S?
    private let keys: [String]
    private let requirement: FeatureRequirement
    private let negate: Bool
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none

    init(
        subscriber: S,
        keys: [String],
        requirement: FeatureRequirement,
        negate: Bool,
        service: TogglyService?
    ) {
        self.subscriber = subscriber
        self.keys = keys
        self.requirement = requirement
        self.negate = negate
        self.service = service
    }

    func request(_ demand: Subscribers.Demand) {
        self.demand += demand

        guard demand > 0 else { return }

        Task {
            await setup()
        }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly = toggly else {
            emit(negate)
            return
        }

        // Emit initial value
        let isEnabled = await toggly.evaluateFeatureGate(
            featureKeys: keys,
            requirement: requirement,
            negate: negate
        )
        emit(isEnabled)

        // Subscribe to changes
        unsubscribe = await toggly.addStateChangeHandler { [weak self] featureKey, _, _ in
            guard let self = self, self.keys.contains(featureKey) else { return }
            Task {
                guard let toggly = self.service ?? (Toggly.isConfigured ? Toggly.shared : nil) else { return }
                let value = await toggly.evaluateFeatureGate(
                    featureKeys: self.keys,
                    requirement: self.requirement,
                    negate: self.negate
                )
                self.emit(value)
            }
        }
    }

    private func emit(_ value: Bool) {
        guard demand > 0, let subscriber = subscriber else { return }
        demand -= 1
        demand += subscriber.receive(value)
    }

    func cancel() {
        unsubscribe?()
        subscriber = nil
    }
}
