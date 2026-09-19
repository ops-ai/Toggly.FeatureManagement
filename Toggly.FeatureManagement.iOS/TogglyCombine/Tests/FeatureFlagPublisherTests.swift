import XCTest
import Combine
@testable import TogglyCore
@testable import TogglyCombine

final class FeatureFlagPublisherTests: XCTestCase {
    final class LimitedSubscriber: Subscriber {
        typealias Input = Bool
        typealias Failure = Never
        var subscription: Subscription?
        var values: [Bool] = []
        let first: XCTestExpectation
        init(first: XCTestExpectation) { self.first = first }
        func receive(subscription: Subscription) {
            self.subscription = subscription
            subscription.request(.max(1))
        }
        func receive(_ input: Bool) -> Subscribers.Demand {
            values.append(input)
            if values.count == 1 { first.fulfill() }
            return .none
        }
        func receive(completion: Subscribers.Completion<Never>) {}
    }

    func testCachedRefreshCountsOnlyAcceptedDemandAndStopsAfterCancellation() async throws {
        let requests = RequestBodies()
        var config = TogglyConfig(appKey: "test-app", featureDefaults: ["publisher-flag": true], refreshInterval: 0, enableLiveUpdates: false)
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        let first = expectation(description: "initial publisher emission")
        let subscriber = LimitedSubscriber(first: first)
        FeatureFlagPublisher("publisher-flag", service: service).receive(subscriber: subscriber)
        await fulfillment(of: [first], timeout: 1)
        for _ in 0..<100 {
            if await service.stateChangeHandlerCount > 0 { break }
            await Task.yield()
        }
        let handlerCount = await service.stateChangeHandlerCount
        XCTAssertEqual(handlerCount, 1)

        await service.notifyFeatureChanges(previousFlags: ["publisher-flag": true], newFlags: ["publisher-flag": false])
        XCTAssertEqual(subscriber.values, [true])
        await service.flushTelemetry()
        var bodies = await requests.bodies
        XCTAssertEqual((bodies.last?["f"] as? [String: [String: [Int]]])?["publisher-flag"]?["enabled"], [1])

        subscriber.subscription?.request(.max(1))
        await service.notifyFeatureChanges(previousFlags: ["publisher-flag": false], newFlags: ["publisher-flag": true])
        XCTAssertEqual(subscriber.values, [true, true])
        for _ in 0..<100 { await Task.yield() }
        await service.flushTelemetry()
        bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 2)
        XCTAssertEqual((bodies.last?["f"] as? [String: [String: [Int]]])?["publisher-flag"]?["enabled"], [1])

        subscriber.subscription?.cancel()
        await service.notifyFeatureChanges(previousFlags: ["publisher-flag": true], newFlags: ["publisher-flag": false])
        await service.flushTelemetry()
        bodies = await requests.bodies
        XCTAssertEqual(subscriber.values, [true, true])
        XCTAssertEqual(bodies.count, 2)
    }
    func testCachedEmissionKeepsAttributionWhenSubscriberStartsIdentityChange() async throws {
        let requests = RequestBodies()
        var config = TogglyConfig(appKey: "test-app", identity: "alice", featureDefaults: ["publisher-flag": true],
                                  refreshInterval: 0, enableLiveUpdates: false, instanceId: "minted-a")
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        let first = expectation(description: "first value")
        let changed = expectation(description: "subscriber rotated identity")
        FeatureFlagPublisher("publisher-flag", service: service).sink { value in
            if value { first.fulfill() }
            else { Task { await service.setIdentity("bob", instanceId: "minted-b"); changed.fulfill() } }
        }.store(in: &cancellables)
        await fulfillment(of: [first], timeout: 2)
        for _ in 0..<100 {
            if await service.stateChangeHandlerCount > 0 { break }
            await Task.yield()
        }
        await service.notifyFeatureChanges(previousFlags: ["publisher-flag": true], newFlags: ["publisher-flag": false])
        await fulfillment(of: [changed], timeout: 2)
        for _ in 0..<100 { await Task.yield() }
        await service.recordUsage("new-user")
        await service.flushTelemetry()
        let bodies = await requests.bodies
        let old = bodies.filter { $0["i"] as? String == "minted-a" }
        let checks = old.compactMap { ($0["f"] as? [String: [String: [Int]]])?["publisher-flag"] }
        XCTAssertEqual(checks.reduce(0) { $0 + ($1["enabled"]?.first ?? 0) + ($1["disabled"]?.first ?? 0) }, 2)
        let new = bodies.filter { $0["i"] as? String == "minted-b" }
        XCTAssertEqual(new.count, 1)
        XCTAssertNil((new.first?["f"] as? [String: [String: [Int]]])?["publisher-flag"])
        await service.dispose()
    }

    actor RequestBodies {
        var bodies: [[String: Any]] = []
        func append(_ request: URLRequest) throws {
            bodies.append(try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any])
        }
    }

    func testPublisherInitialEvaluationCountsOnce() async throws {
        let requests = RequestBodies()
        var config = TogglyConfig(appKey: "test-app", featureDefaults: ["publisher-flag": true], refreshInterval: 0, enableLiveUpdates: false)
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        let emitted = expectation(description: "publisher evaluated")
        FeatureFlagPublisher("publisher-flag", service: service)
            .sink { value in XCTAssertTrue(value); emitted.fulfill() }
            .store(in: &cancellables)
        await fulfillment(of: [emitted], timeout: 1)
        await service.flushTelemetry()
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
        let features = try XCTUnwrap(bodies.first?["f"] as? [String: [String: [Int]]])
        XCTAssertEqual(features["publisher-flag"]?["enabled"], [1])
    }
    var cancellables: Set<AnyCancellable>!

    override func setUp() {
        cancellables = []
    }

    override func tearDown() {
        cancellables = nil
        Toggly.reset()
    }

    func testFeatureFlagPublisherEmitsValue() async {
        let config = TogglyConfig(featureDefaults: ["test-feature": true])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Publisher emits value")
        var receivedValue: Bool?

        FeatureFlagPublisher("test-feature")
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testFeatureFlagPublisherWithDefaultValue() async {
        // No service configured
        let expectation = XCTestExpectation(description: "Publisher emits default")
        var receivedValue: Bool?

        FeatureFlagPublisher("nonexistent", defaultValue: true)
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testFeatureGatePublisher() async {
        let config = TogglyConfig(featureDefaults: [
            "feature1": true,
            "feature2": true
        ])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Gate publisher emits value")
        var receivedValue: Bool?

        FeatureGatePublisher(["feature1", "feature2"], requirement: .all)
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testFeatureGatePublisherAny() async {
        let config = TogglyConfig(featureDefaults: [
            "feature1": true,
            "feature2": false
        ])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Gate publisher emits value")
        var receivedValue: Bool?

        FeatureGatePublisher(["feature1", "feature2"], requirement: .any)
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }

    func testTogglyPublishersConvenience() async {
        let config = TogglyConfig(featureDefaults: ["my-feature": true])
        Toggly.configure(config: config)
        await Toggly.shared.initialize()

        let expectation = XCTestExpectation(description: "Convenience publisher emits value")
        var receivedValue: Bool?

        TogglyPublishers.featureFlag("my-feature")
            .sink { value in
                receivedValue = value
                expectation.fulfill()
            }
            .store(in: &cancellables)

        await fulfillment(of: [expectation], timeout: 1.0)

        XCTAssertEqual(receivedValue, true)
    }
}
