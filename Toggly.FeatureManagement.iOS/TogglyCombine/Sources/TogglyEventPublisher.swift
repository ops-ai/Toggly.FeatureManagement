import Combine
import TogglyCore

/// A publisher that emits Toggly events.
public struct TogglyEventPublisher: Publisher {
    public typealias Output = TogglyEvent
    public typealias Failure = Never

    private let service: TogglyService?

    /// Creates a Toggly event publisher.
    /// - Parameter service: The Toggly service to use.
    public init(service: TogglyService? = nil) {
        self.service = service
    }

    public func receive<S>(subscriber: S) where S: Subscriber, Failure == S.Failure, Output == S.Input {
        let subscription = TogglyEventSubscription(
            subscriber: subscriber,
            service: service
        )
        subscriber.receive(subscription: subscription)
    }
}

private final class TogglyEventSubscription<S: Subscriber>: Subscription where S.Input == TogglyEvent, S.Failure == Never {
    private var subscriber: S?
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none

    init(subscriber: S, service: TogglyService?) {
        self.subscriber = subscriber
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

        guard let toggly = toggly else { return }

        unsubscribe = await toggly.on { [weak self] event in
            self?.emit(event)
        }
    }

    private func emit(_ event: TogglyEvent) {
        guard demand > 0, let subscriber = subscriber else { return }
        demand -= 1
        demand += subscriber.receive(event)
    }

    func cancel() {
        unsubscribe?()
        subscriber = nil
    }
}

/// A publisher that emits feature change events.
public struct FeatureChangedPublisher: Publisher {
    public typealias Output = FeatureChangedEvent
    public typealias Failure = Never

    private let featureKey: String?
    private let service: TogglyService?

    /// Creates a feature changed publisher.
    /// - Parameters:
    ///   - featureKey: Optional key to filter events. If nil, emits all changes.
    ///   - service: The Toggly service to use.
    public init(featureKey: String? = nil, service: TogglyService? = nil) {
        self.featureKey = featureKey
        self.service = service
    }

    public func receive<S>(subscriber: S) where S: Subscriber, Failure == S.Failure, Output == S.Input {
        let subscription = FeatureChangedSubscription(
            subscriber: subscriber,
            featureKey: featureKey,
            service: service
        )
        subscriber.receive(subscription: subscription)
    }
}

private final class FeatureChangedSubscription<S: Subscriber>: Subscription where S.Input == FeatureChangedEvent, S.Failure == Never {
    private var subscriber: S?
    private let featureKey: String?
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none

    init(subscriber: S, featureKey: String?, service: TogglyService?) {
        self.subscriber = subscriber
        self.featureKey = featureKey
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

        guard let toggly = toggly else { return }

        unsubscribe = await toggly.addStateChangeHandler { [weak self] key, previousValue, newValue in
            guard let self = self else { return }

            // Filter by key if specified
            if let filterKey = self.featureKey, key != filterKey {
                return
            }

            let event = FeatureChangedEvent(
                featureKey: key,
                previousValue: previousValue,
                newValue: newValue
            )
            self.emit(event)
        }
    }

    private func emit(_ event: FeatureChangedEvent) {
        guard demand > 0, let subscriber = subscriber else { return }
        demand -= 1
        demand += subscriber.receive(event)
    }

    func cancel() {
        unsubscribe?()
        subscriber = nil
    }
}
