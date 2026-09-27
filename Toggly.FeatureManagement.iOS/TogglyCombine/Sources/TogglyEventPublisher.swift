import Combine
import Foundation
import TogglyCore

private final class EventSubscriptionState<S: Subscriber> where S.Failure == Never {
    private let lock = NSRecursiveLock()
    private var subscriber: S?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none
    private var setupStarted = false

    init(subscriber: S) {
        self.subscriber = subscriber
    }

    func activeService(_ service: TogglyService?) -> TogglyService? {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)
        return lock.withLock { subscriber != nil } ? toggly : nil
    }

    func request(_ newDemand: Subscribers.Demand) -> Bool {
        lock.withLock {
            guard subscriber != nil else { return false }
            demand += newDemand
            guard demand > 0, !setupStarted else { return false }
            setupStarted = true
            return true
        }
    }

    func install(_ remove: @escaping @Sendable () -> Void) {
        let alreadyCancelled = lock.withLock { () -> Bool in
            guard subscriber != nil else { return true }
            unsubscribe = remove
            return false
        }
        if alreadyCancelled { remove() }
    }

    func emit(_ value: S.Input) {
        lock.withLock {
            guard demand > 0, let subscriber else { return }
            demand -= 1
            demand += subscriber.receive(value)
        }
    }

    func cancel() {
        let remove = lock.withLock { () -> (@Sendable () -> Void)? in
            subscriber = nil
            demand = .none
            let remove = unsubscribe
            unsubscribe = nil
            return remove
        }
        remove?()
    }
}

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

private final class TogglyEventSubscription<S: Subscriber>: Subscription
where S.Input == TogglyEvent, S.Failure == Never {
    private let state: EventSubscriptionState<S>
    private let service: TogglyService?

    init(subscriber: S, service: TogglyService?) {
        self.state = EventSubscriptionState(subscriber: subscriber)
        self.service = service
    }

    func request(_ demand: Subscribers.Demand) {
        if state.request(demand) { Task { await setup() } }
    }

    private func setup() async {
        guard let toggly = state.activeService(service) else { return }

        let remove = await toggly.on { [weak self] event in
            self?.state.emit(event)
        }
        state.install(remove)
    }

    func cancel() {
        state.cancel()
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

private final class FeatureChangedSubscription<S: Subscriber>: Subscription
where S.Input == FeatureChangedEvent, S.Failure == Never {
    private let state: EventSubscriptionState<S>
    private let featureKey: String?
    private let service: TogglyService?

    init(subscriber: S, featureKey: String?, service: TogglyService?) {
        self.state = EventSubscriptionState(subscriber: subscriber)
        self.featureKey = featureKey
        self.service = service
    }

    func request(_ demand: Subscribers.Demand) {
        if state.request(demand) { Task { await setup() } }
    }

    private func setup() async {
        guard let toggly = state.activeService(service) else { return }

        let remove = await toggly.addStateChangeHandler { [weak self] key, previousValue, newValue in
            guard let self else { return }

            // Filter by key if specified
            if let filterKey = self.featureKey, key != filterKey {
                return
            }

            let event = FeatureChangedEvent(
                featureKey: key,
                previousValue: previousValue,
                newValue: newValue
            )
            self.state.emit(event)
        }
        state.install(remove)
    }

    func cancel() {
        state.cancel()
    }
}
