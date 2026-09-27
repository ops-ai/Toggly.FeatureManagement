import Combine
import Foundation
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
    private let lock = NSRecursiveLock()
    private var subscriber: S?
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none
    private var setupStarted = false

    init(subscriber: S, service: TogglyService?) {
        self.subscriber = subscriber
        self.service = service
    }

    func request(_ demand: Subscribers.Demand) {
        let shouldStart = lock.withLock { () -> Bool in
            guard subscriber != nil else { return false }
            self.demand += demand
            guard self.demand > 0, !setupStarted else { return false }
            setupStarted = true
            return true
        }
        if shouldStart { Task { await setup() } }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly, lock.withLock({ subscriber != nil }) else { return }

        let remove = await toggly.on { [weak self] event in
            self?.emit(event)
        }
        let alreadyCancelled = lock.withLock { () -> Bool in
            guard subscriber != nil else { return true }
            unsubscribe = remove
            return false
        }
        if alreadyCancelled { remove() }
    }

    private func emit(_ event: TogglyEvent) {
        lock.withLock {
            guard demand > 0, let subscriber else { return }
            demand -= 1
            demand += subscriber.receive(event)
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
    private let lock = NSRecursiveLock()
    private var subscriber: S?
    private let featureKey: String?
    private let service: TogglyService?
    private var unsubscribe: (@Sendable () -> Void)?
    private var demand: Subscribers.Demand = .none
    private var setupStarted = false

    init(subscriber: S, featureKey: String?, service: TogglyService?) {
        self.subscriber = subscriber
        self.featureKey = featureKey
        self.service = service
    }

    func request(_ demand: Subscribers.Demand) {
        let shouldStart = lock.withLock { () -> Bool in
            guard subscriber != nil else { return false }
            self.demand += demand
            guard self.demand > 0, !setupStarted else { return false }
            setupStarted = true
            return true
        }
        if shouldStart { Task { await setup() } }
    }

    private func setup() async {
        let toggly = service ?? (Toggly.isConfigured ? Toggly.shared : nil)

        guard let toggly, lock.withLock({ subscriber != nil }) else { return }

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
            self.emit(event)
        }
        let alreadyCancelled = lock.withLock { () -> Bool in
            guard subscriber != nil else { return true }
            unsubscribe = remove
            return false
        }
        if alreadyCancelled { remove() }
    }

    private func emit(_ event: FeatureChangedEvent) {
        lock.withLock {
            guard demand > 0, let subscriber else { return }
            demand -= 1
            demand += subscriber.receive(event)
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
