#if canImport(UIKit) && !os(watchOS)
import XCTest
@testable import TogglyCore
@testable import TogglyUIKit

final class FeatureFlagAsyncTests: XCTestCase {
    actor RequestBodies {
        var bodies: [[String: Any]] = []
        func append(_ request: URLRequest) throws {
            bodies.append(try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any])
        }
    }

    func testCachedViewControllerReadCountsPresentedValue() async throws {
        let requests = RequestBodies()
        var config = TogglyConfig(appKey: "test-app", featureDefaults: ["ui-flag": true], refreshInterval: 0, enableLiveUpdates: false)
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        let controller = await MainActor.run { FeatureFlagViewController() }
        await MainActor.run {
            controller.togglyService = service
            controller.observeFeature("ui-flag")
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        let cached = await MainActor.run { controller.isFeatureEnabled("ui-flag") }
        XCTAssertTrue(cached)
        try await Task.sleep(nanoseconds: 50_000_000)
        await service.flushTelemetry()
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
        let features = try XCTUnwrap(bodies.first?["f"] as? [String: [String: [Int]]])
        XCTAssertEqual(features["ui-flag"]?["enabled"], [2])
    }
    func testCachedControllerSnapshotKeepsOriginalUserAndRejectsForeignOwner() async throws {
        let requests = RequestBodies()
        var config = TogglyConfig(appKey: "test-app", identity: "alice", featureDefaults: ["ui-flag": true],
                                  refreshInterval: 0, enableLiveUpdates: false, instanceId: "minted-a")
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let owner = TogglyService(config: config)
        await owner.setNetworkState(.disconnected); await owner.initialize()
        let controller = await MainActor.run { FeatureFlagViewController() }
        await MainActor.run { controller.togglyService = owner; controller.observeFeature("ui-flag") }
        try await Task.sleep(nanoseconds: 100_000_000)
        await owner.setIdentity("bob", instanceId: "minted-b")
        let cached = await MainActor.run { controller.isFeatureEnabled("ui-flag") }
        XCTAssertTrue(cached)
        try await Task.sleep(nanoseconds: 50_000_000)
        let other = TogglyService(config: config)
        await MainActor.run { controller.togglyService = other; _ = controller.isFeatureEnabled("ui-flag") }
        try await Task.sleep(nanoseconds: 50_000_000)
        await other.flushTelemetry(); await owner.flushTelemetry()
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
        XCTAssertEqual(bodies.first?["i"] as? String, "minted-a")
        XCTAssertEqual((bodies.first?["f"] as? [String: [String: [Int]]])?["ui-flag"]?["enabled"], [2])
        await owner.dispose(); await other.dispose()
    }

    var service: TogglyService!

    override func setUp() async throws {
        let config = TogglyConfig(featureDefaults: [
            "enabled-feature": true,
            "disabled-feature": false
        ])
        service = TogglyService(config: config)
        await service.initialize()

        Toggly.configure(config: config)
        await Toggly.shared.initialize()
    }

    override func tearDown() {
        Toggly.reset()
    }

    func testIsEnabled() async {
        let enabled = await FeatureFlagAsync.isEnabled("enabled-feature", service: service)
        let disabled = await FeatureFlagAsync.isEnabled("disabled-feature", service: service)

        XCTAssertTrue(enabled)
        XCTAssertFalse(disabled)
    }

    func testIsDisabled() async {
        let enabled = await FeatureFlagAsync.isDisabled("enabled-feature", service: service)
        let disabled = await FeatureFlagAsync.isDisabled("disabled-feature", service: service)

        XCTAssertFalse(enabled)
        XCTAssertTrue(disabled)
    }

    func testEvaluateAll() async {
        let allEnabled = await FeatureFlagAsync.evaluate(
            ["enabled-feature"],
            requirement: .all,
            service: service
        )
        let notAllEnabled = await FeatureFlagAsync.evaluate(
            ["enabled-feature", "disabled-feature"],
            requirement: .all,
            service: service
        )

        XCTAssertTrue(allEnabled)
        XCTAssertFalse(notAllEnabled)
    }

    func testEvaluateAny() async {
        let anyEnabled = await FeatureFlagAsync.evaluate(
            ["enabled-feature", "disabled-feature"],
            requirement: .any,
            service: service
        )
        let noneEnabled = await FeatureFlagAsync.evaluate(
            ["disabled-feature"],
            requirement: .any,
            service: service
        )

        XCTAssertTrue(anyEnabled)
        XCTAssertFalse(noneEnabled)
    }

    func testIfEnabled() async {
        var executed = false

        await FeatureFlagAsync.ifEnabled("enabled-feature", service: service) {
            executed = true
        }

        XCTAssertTrue(executed)
    }

    func testIfEnabledNotExecuted() async {
        var executed = false

        await FeatureFlagAsync.ifEnabled("disabled-feature", service: service) {
            executed = true
        }

        XCTAssertFalse(executed)
    }

    func testIfDisabled() async {
        var executed = false

        await FeatureFlagAsync.ifDisabled("disabled-feature", service: service) {
            executed = true
        }

        XCTAssertTrue(executed)
    }

    func testChoose() async {
        let result = await FeatureFlagAsync.choose(
            "enabled-feature",
            service: service,
            enabled: { "enabled" },
            disabled: { "disabled" }
        )

        XCTAssertEqual(result, "enabled")
    }

    func testChooseDisabled() async {
        let result = await FeatureFlagAsync.choose(
            "disabled-feature",
            service: service,
            enabled: { "enabled" },
            disabled: { "disabled" }
        )

        XCTAssertEqual(result, "disabled")
    }
}
#endif
