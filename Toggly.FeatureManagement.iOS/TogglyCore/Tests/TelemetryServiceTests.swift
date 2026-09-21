import Foundation
import XCTest
@testable import TogglyCore

final class TelemetryServiceTests: XCTestCase {
    actor Requests {
        var bodies: [[String: Any]] = []
        func append(_ request: URLRequest) throws {
            let body = try XCTUnwrap(request.httpBody)
            bodies.append(try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any]))
        }
    }

    func testActualGateLeavesCountBeforeNegationAndRespectShortCircuit() async throws {
        let requests = Requests()
        var config = TogglyConfig(
            appKey: "public-app", identity: "private-user",
            featureDefaults: ["on": true, "off": false, "skipped": true],
            refreshInterval: 0, enableLiveUpdates: false
        )
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()

        let offGate = await service.evaluateFeatureGate(featureKeys: ["off", "skipped"], requirement: .all, negate: true)
        let onGate = await service.evaluateFeatureGate(featureKeys: ["on", "skipped"], requirement: .any)
        XCTAssertTrue(offGate)
        XCTAssertTrue(onGate)
        await service.recordUsage("on")
        await service.flushTelemetry()

        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
        let body = try XCTUnwrap(bodies.first)
        XCTAssertEqual(Set(body.keys), Set(["k", "e", "u", "f"]))
        XCTAssertEqual(body["u"] as? String, "private-user")
        let features = try XCTUnwrap(body["f"] as? [String: [String: [Int]]])
        XCTAssertEqual(features["off"]?["disabled"], [1])
        XCTAssertEqual(features["on"]?["enabled"], [1, 1])
        XCTAssertNil(features["skipped"])
    }

    func testIdentityRotationGeneratedFallbackAndOwnerBoundDelayedSnapshots() async throws {
        let requests = Requests()
        let storage = MemoryStorage()
        await storage.set(TogglyStorageKeys.deviceId, value: "stored-device")
        var config = TogglyConfig(appKey: "public-app", featureDefaults: ["on": true], refreshInterval: 0,
                                  storage: storage, enableLiveUpdates: false)
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.recordUsage("before-initialize")
        await service.initialize()
        await service.recordUsage("device")
        await service.setIdentity("alice", instanceId: "minted-a")
        let old = await service.captureFeatureCheck("on")
        await service.recordUsage("alice")
        await service.setIdentity("bob", instanceId: "minted-b")
        await service.recordUsage("bob")
        await service.recordCheck(old)
        let other = TogglyService(config: config)
        await other.recordCheck(old)
        await other.flushTelemetry()
        await service.setInstanceId(nil)
        await service.recordUsage("fallback-bob")
        await service.setIdentity(nil)
        await service.recordUsage("logout")
        await service.flushTelemetry()
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 7)
        XCTAssertNil(bodies[0]["u"])
        XCTAssertEqual(bodies[1]["u"] as? String, "stored-device")
        XCTAssertEqual(bodies[2]["i"] as? String, "minted-a")
        XCTAssertEqual(bodies[3]["i"] as? String, "minted-b")
        XCTAssertEqual(bodies[4]["i"] as? String, "minted-a")
        XCTAssertEqual(bodies[5]["u"] as? String, "bob")
        XCTAssertEqual(bodies[6]["u"] as? String, "stored-device")
        XCTAssertEqual((bodies[4]["f"] as? [String: [String: [Int]]])?["on"]?["enabled"], [1])
        await service.dispose(); await other.dispose()
    }

    func testGeneratedIdentityAndLegacySetterClearPriorToken() async throws {
        let requests = Requests()
        var config = TogglyConfig(appKey: "public-app", identity: "alice", refreshInterval: 0,
                                  enableLiveUpdates: false, instanceId: "minted-a")
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        await service.setIdentity("bob")
        await service.recordUsage("bob")
        await service.setIdentity(nil)
        let generated = await service.currentIdentity
        XCTAssertNotNil(generated)
        await service.recordUsage("anonymous-device")
        await service.flushTelemetry()
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 2)
        XCTAssertEqual(bodies[0]["u"] as? String, "bob")
        XCTAssertNil(bodies[0]["i"])
        XCTAssertEqual(bodies[1]["u"] as? String, generated)
        await service.dispose()
        await service.initialize()
        await service.recordUsage("disposed")
        await service.setInstanceId("must-not-revive")
        await service.flushTelemetry()
        let final = await requests.bodies
        XCTAssertEqual(final.count, 2)
    }

    func testBackgroundFlushesWithoutNewCheck() async throws {
        let requests = Requests()
        var config = TogglyConfig(appKey: "public-app", featureDefaults: ["on": true], refreshInterval: 0, enableLiveUpdates: false)
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.setNetworkState(.disconnected)
        await service.initialize()
        let isOn = await service.isFeatureOn("on")
        XCTAssertTrue(isOn)
        await service.setAppState(.background)
        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
    }
}
