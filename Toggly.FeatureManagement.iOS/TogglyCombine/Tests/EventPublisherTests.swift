import Combine
import XCTest
@testable import TogglyCore
@testable import TogglyCombine

final class EventPublisherTests: XCTestCase {
    private final class RecordingSubscriber<Input>: Subscriber {
        typealias Failure = Never

        private let lock = NSLock()
        private var received: [Input] = []
        private var currentSubscription: Subscription?

        var values: [Input] { lock.withLock { received } }
        var subscription: Subscription? { lock.withLock { currentSubscription } }

        func receive(subscription: Subscription) {
            lock.withLock { currentSubscription = subscription }
        }

        func receive(_ input: Input) -> Subscribers.Demand {
            lock.withLock { received.append(input) }
            return .none
        }

        func receive(completion: Subscribers.Completion<Never>) {}
    }

    private func makeService() -> TogglyService {
        TogglyService(config: TogglyConfig(
            featureDefaults: ["checkout": false],
            refreshInterval: 0,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
    }

    func testAdditionalDemandDoesNotSubscribeTwiceToEvents() async throws {
        let service = makeService()
        let subscriber = RecordingSubscriber<TogglyEvent>()
        let publisher = await service.eventPublisher()
        publisher.receive(subscriber: subscriber)
        subscriber.subscription?.request(.unlimited)
        subscriber.subscription?.request(.unlimited)
        try await Task.sleep(nanoseconds: 50_000_000)

        await service.notifyFeatureChanges(previousFlags: ["checkout": false], newFlags: ["checkout": true])
        let changed = subscriber.values.compactMap { event -> String? in
            guard case .featureChanged(let change) = event else { return nil }
            return change.featureKey
        }
        XCTAssertEqual(changed, ["checkout"])
        subscriber.subscription?.cancel()
        await service.dispose()
    }

    func testAdditionalDemandDoesNotSubscribeTwiceToFilteredChanges() async throws {
        let service = makeService()
        let subscriber = RecordingSubscriber<FeatureChangedEvent>()
        let publisher = await service.featureChangedPublisher(featureKey: "checkout")
        publisher.receive(subscriber: subscriber)
        subscriber.subscription?.request(.unlimited)
        subscriber.subscription?.request(.unlimited)
        try await Task.sleep(nanoseconds: 50_000_000)

        await service.notifyFeatureChanges(
            previousFlags: ["checkout": false, "other": false],
            newFlags: ["checkout": true, "other": true]
        )
        XCTAssertEqual(subscriber.values.map(\.featureKey), ["checkout"])
        subscriber.subscription?.cancel()
        await service.dispose()
    }

    func testEventPublisherHonorsDemandAndStopsAfterCancellation() async throws {
        let service = makeService()
        let subscriber = RecordingSubscriber<TogglyEvent>()
        TogglyEventPublisher(service: service).receive(subscriber: subscriber)
        subscriber.subscription?.request(.max(1))
        try await Task.sleep(nanoseconds: 50_000_000)

        await service.notifyFeatureChanges(previousFlags: ["checkout": false], newFlags: ["checkout": true])
        await service.notifyFeatureChanges(previousFlags: ["checkout": true], newFlags: ["checkout": false])
        XCTAssertEqual(subscriber.values.count, 1)

        subscriber.subscription?.request(.max(1))
        await service.notifyFeatureChanges(previousFlags: ["checkout": false], newFlags: ["checkout": true])
        XCTAssertEqual(subscriber.values.count, 2)

        subscriber.subscription?.cancel()
        await service.notifyFeatureChanges(previousFlags: ["checkout": true], newFlags: ["checkout": false])
        XCTAssertEqual(subscriber.values.count, 2)
        await service.dispose()
    }

    func testFeatureChangesWithoutFilterEmitEachKeyAndHonorDemand() async throws {
        let service = makeService()
        let subscriber = RecordingSubscriber<FeatureChangedEvent>()
        FeatureChangedPublisher(service: service).receive(subscriber: subscriber)
        subscriber.subscription?.request(.max(2))
        try await Task.sleep(nanoseconds: 50_000_000)

        await service.notifyFeatureChanges(
            previousFlags: ["checkout": false, "other": false],
            newFlags: ["checkout": true, "other": true]
        )
        XCTAssertEqual(subscriber.values.map(\.featureKey).sorted(), ["checkout", "other"])
        XCTAssertTrue(subscriber.values.allSatisfy { $0.previousValue == false && $0.newValue == true })

        await service.notifyFeatureChanges(previousFlags: ["checkout": true], newFlags: ["checkout": false])
        XCTAssertEqual(subscriber.values.count, 2)
        subscriber.subscription?.cancel()
        await service.dispose()
    }

    func testSharedPublisherFactoriesDeliverEventsAndFilteredChanges() async throws {
        Toggly.configure(config: TogglyConfig(
            featureDefaults: ["checkout": false],
            refreshInterval: 0,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
        defer { Toggly.reset() }
        let events = RecordingSubscriber<TogglyEvent>()
        let changes = RecordingSubscriber<FeatureChangedEvent>()
        TogglyPublishers.events().receive(subscriber: events)
        TogglyPublishers.featureChanged(featureKey: "checkout").receive(subscriber: changes)
        events.subscription?.request(.unlimited)
        changes.subscription?.request(.unlimited)
        try await Task.sleep(nanoseconds: 50_000_000)

        await Toggly.shared.notifyFeatureChanges(
            previousFlags: ["checkout": false, "other": false],
            newFlags: ["checkout": true, "other": true]
        )
        let changedKeys = events.values.compactMap { event -> String? in
            guard case .featureChanged(let change) = event else { return nil }
            return change.featureKey
        }
        XCTAssertEqual(changedKeys.sorted(), ["checkout", "other"])
        XCTAssertEqual(changes.values.map(\.featureKey), ["checkout"])
        events.subscription?.cancel()
        changes.subscription?.cancel()
        await Toggly.shared.dispose()
    }
}
