import XCTest
@testable import TogglyCore
@testable import TogglySwiftUI

@MainActor
final class FeatureFlagObserverTests: XCTestCase {
    actor RequestBodies {
        var bodies: [[String: Any]] = []
        func append(_ request: URLRequest) throws {
            bodies.append(try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any])
        }
    }

    func testObserverCountsEvaluationOnceWhileCachedValueIsRead() async throws {
        let requests = RequestBodies()
        var config = TogglyConfig(appKey: "test-app", featureDefaults: ["ui-flag": true], refreshInterval: 0, enableLiveUpdates: false)
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        let observer = FeatureFlagObserver(key: "ui-flag", defaultValue: false, service: service)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertTrue(observer.isEnabled)
        XCTAssertTrue(observer.isEnabled)
        await service.flushTelemetry()
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
        let features = try XCTUnwrap(bodies.first?["f"] as? [String: [String: [Int]]])
        XCTAssertEqual(features["ui-flag"]?["enabled"], [1])
    }
    override func tearDown() {
        Toggly.reset()
    }

    func testObserverWithDefaultValue() async {
        let observer = FeatureFlagObserver(
            key: "test-feature",
            defaultValue: true,
            service: nil
        )

        // Without a configured service, should use default
        // Give it a moment to set up
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertTrue(observer.isEnabled)
    }

    func testObserverWithService() async {
        let config = TogglyConfig(featureDefaults: ["my-feature": true])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureFlagObserver(
            key: "my-feature",
            defaultValue: false,
            service: service
        )

        // Give it a moment to set up
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertTrue(observer.isEnabled)
    }

    func testObserverWithDisabledFeature() async {
        let config = TogglyConfig(featureDefaults: ["my-feature": false])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureFlagObserver(
            key: "my-feature",
            defaultValue: true,
            service: service
        )

        // Give it a moment to set up
        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertFalse(observer.isEnabled)
    }

    func testObserverNegateShowsWhenDisabled() async {
        let config = TogglyConfig(featureDefaults: ["maintenance": false])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureFlagObserver(
            key: "maintenance",
            defaultValue: false,
            negate: true,
            service: service
        )

        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertTrue(observer.isEnabled)
    }

    func testGateObserverNegateInverts() async {
        let config = TogglyConfig(featureDefaults: ["f1": true])
        let service = TogglyService(config: config)
        await service.initialize()

        let observer = FeatureGateObserver(
            keys: ["f1"],
            requirement: .all,
            negate: true,
            service: service
        )

        try? await Task.sleep(nanoseconds: 200_000_000)

        XCTAssertFalse(observer.isEnabled)
    }
}
