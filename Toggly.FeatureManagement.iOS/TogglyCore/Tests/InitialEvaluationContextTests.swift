import XCTest
import CryptoKit
@testable import TogglyCore

private final class InitialContextURLProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var fail = false
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "initial-context.invalid"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        if Self.fail {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
        } else {
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["ETag": "same-revision"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("{\"targeted\":true}".utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}

private actor DelayedInvalidCacheStorage: TogglyStorage {
    var values: [String: String] = [:]
    let key: String
    let paused: XCTestExpectation
    private var didPause = false
    private var continuation: CheckedContinuation<Void, Never>?
    init(key: String, paused: XCTestExpectation) { self.key = key; self.paused = paused }
    func get(_ key: String) async -> String? {
        let captured = values[key]
        if key == self.key && !didPause {
            didPause = true
            await withCheckedContinuation { continuation = $0; paused.fulfill() }
        }
        return captured
    }
    func resume() { continuation?.resume(); continuation = nil }
    func set(_ key: String, value: String) { values[key] = value }
    func delete(_ key: String) { values.removeValue(forKey: key) }
    func clear() { values = [:] }
}

final class InitialEvaluationContextTests: XCTestCase {
    override func setUp() {
        super.setUp()
        InitialContextURLProtocol.requests = []
        InitialContextURLProtocol.fail = false
        URLProtocol.registerClass(InitialContextURLProtocol.self)
    }
    override func tearDown() {
        URLProtocol.unregisterClass(InitialContextURLProtocol.self)
        super.tearDown()
    }
    func testMintedDefinitionsSuppressClientTargetingAndPreserveUnrelatedQueries() async throws {
        let service = TogglyService(config: TogglyConfig(
            appKey: "app", baseURI: "https://initial-context.invalid/prefix?x=kept&u=stale&g=stale&claim.bad=stale",
            identity: "alice", refreshInterval: 0, useSignedDefinitions: true, enableLiveUpdates: false,
            groups: ["beta"], claims: ["plan": "pro"], enableTelemetry: false, instanceId: " mint+a&one "))
        await service.initialize()
        let first = InitialContextURLProtocol.requests.last!
        let items = URLComponents(url: first.url!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(first.url!.path, "/prefix/evaluated-signed/app/Production")
        XCTAssertEqual(items, [URLQueryItem(name: "x", value: "kept"), URLQueryItem(name: "i", value: "mint+a&one")])
        await service.refresh()
        XCTAssertEqual(InitialContextURLProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "same-revision")
        await service.setInstanceId("mint-two")
        XCTAssertNil(InitialContextURLProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"))
        await service.setInstanceId(nil)
        let fallback = URLComponents(url: InitialContextURLProtocol.requests.last!.url!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(fallback, [URLQueryItem(name: "x", value: "kept"), URLQueryItem(name: "u", value: "alice"), URLQueryItem(name: "g", value: "beta"), URLQueryItem(name: "claim.plan", value: "pro")])
        await service.dispose()
    }

    func testMintedRequestsRemoveInheritedUserIdsAcrossRotationAndRestoreLegacyOnClear() async throws {
        let service = makeInheritedUserIdService(instanceId: "mint-one")
        let initial = await service.initialize()
        XCTAssertEqual(initial.flags["targeted"], true)
        assertInheritedUserIdRequest(instanceId: "mint-one")
        let rotated = await service.setInstanceId("mint+two&three")
        XCTAssertEqual(rotated.flags["targeted"], true)
        assertInheritedUserIdRequest(instanceId: "mint+two&three")
        XCTAssertNil(InitialContextURLProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"))
        let cleared = await service.setInstanceId(nil)
        XCTAssertEqual(cleared.flags["targeted"], true)
        assertInheritedUserIdRequest(instanceId: nil)
        XCTAssertEqual(InitialContextURLProtocol.requests.count, 3)
        await service.dispose()
    }

    func testLegacyInitializationPreservesInheritedUserIdsForOmittedAndBlankTokens() async throws {
        for token: String? in [nil, " "] {
            let service = makeInheritedUserIdService(instanceId: token)
            let initial = await service.initialize()
            XCTAssertEqual(initial.flags["targeted"], true)
            assertInheritedUserIdRequest(instanceId: nil)
            await service.dispose()
        }
        XCTAssertEqual(InitialContextURLProtocol.requests.count, 2)
    }

    private func makeInheritedUserIdService(instanceId: String?) -> TogglyService {
        TogglyService(config: TogglyConfig(
            appKey: "synthetic", baseURI: "https://initial-context.invalid/prefix/nested?userId=private-one&user%49d=private%2Btwo%26three&userId=&u=stale&g=one&g=two&claim.plan=private&claim%2Erole=private&i=retired&keep=one&keep=two",
            identity: "alice", refreshInterval: 0, useSignedDefinitions: true, enableLiveUpdates: false,
            groups: ["beta"], claims: ["plan": "pro"], enableTelemetry: false, instanceId: instanceId))
    }

    private func assertInheritedUserIdRequest(instanceId: String?, file: StaticString = #filePath, line: UInt = #line) {
        let request = InitialContextURLProtocol.requests.last!
        XCTAssertEqual(request.url!.path, "/prefix/nested/evaluated-signed/synthetic/Production", file: file, line: line)
        let items = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!
        let unrelated = [URLQueryItem(name: "keep", value: "one"), URLQueryItem(name: "keep", value: "two")]
        let expected: [URLQueryItem]
        if let instanceId {
            expected = unrelated + [URLQueryItem(name: "i", value: instanceId)]
        } else {
            expected = [URLQueryItem(name: "userId", value: "private-one"),
                        URLQueryItem(name: "userId", value: "private+two&three"),
                        URLQueryItem(name: "userId", value: "")] + unrelated + [
                        URLQueryItem(name: "u", value: "alice"), URLQueryItem(name: "g", value: "beta"),
                        URLQueryItem(name: "claim.plan", value: "pro")]
        }
        XCTAssertEqual(items, expected, file: file, line: line)
    }

    func testMintedPersistentCacheCannotCrossTokensOrClientMode() async throws {
        let storage = MemoryStorage()
        func make(_ token: String?) -> TogglyService {
            TogglyService(config: TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid",
                identity: "alice", featureDefaults: ["targeted": false], refreshInterval: 0,
                storage: storage, enableLiveUpdates: false, enableTelemetry: false, instanceId: token))
        }
        let original = make("mint-one")
        await original.initialize()
        await original.dispose()
        InitialContextURLProtocol.fail = true
        for (token, expected) in [("mint-one" as String?, true), ("mint-two" as String?, false), (nil, false)] {
            let next = make(token)
            let response = await next.initialize()
            XCTAssertEqual(response.flags["targeted"], expected)
            await next.dispose()
        }
    }

    func testLateInvalidCacheCleanupCannotDeleteNewerATokenCacheAfterABA() async throws {
        let tokenHash = SHA256.hash(data: Data("a".utf8)).map { String(format: "%02x", $0) }.joined()
        let context = String(data: try JSONEncoder().encode([["https://initial-context.invalid", "app", "Production"], ["instanceIdHash", tokenHash]]), encoding: .utf8)!
        let hash = SHA256.hash(data: Data(context.utf8)).map { String(format: "%02x", $0) }.joined()
        let key = TogglyStorageKeys.featureFlagsCache + "v2:" + hash
        let paused = expectation(description: "old invalid A cache read suspended")
        let storage = DelayedInvalidCacheStorage(key: key, paused: paused)
        let invalid = TogglyFeatureFlagsCache(identity: "alice", flags: "invalid", evaluationContext: context)
        await storage.set(key, value: String(data: try JSONEncoder().encode(invalid), encoding: .utf8)!)
        let service = TogglyService(config: TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid", identity: "alice",
            featureDefaults: ["targeted": false], refreshInterval: 0, storage: storage,
            enableLiveUpdates: false, enableTelemetry: false, instanceId: "a"))
        await service.setNetworkState(.disconnected)
        let initial = Task { await service.initialize() }
        await fulfillment(of: [paused], timeout: 2)
        await service.setInstanceId("b")
        let valid = TogglyFeatureFlagsCache(identity: "alice", flags: "{\"targeted\":true}", evaluationContext: context)
        let replacement = String(data: try JSONEncoder().encode(valid), encoding: .utf8)!
        await storage.set(key, value: replacement)
        let current = await service.setInstanceId("a")
        XCTAssertEqual(current.flags["targeted"], true)
        await storage.resume()
        await initial.value
        let retained = await storage.get(key)
        XCTAssertEqual(retained, replacement)
        let flags = await service.currentFeatures
        XCTAssertEqual(flags?["targeted"], true)
        await service.dispose()
    }

    func testDisposeDuringDeviceIdentityResolutionCannotRestartLifecycle() async {
        let paused = expectation(description: "device identity resolution suspended")
        let storage = DelayedInvalidCacheStorage(key: TogglyStorageKeys.deviceId, paused: paused)
        await storage.set(TogglyStorageKeys.deviceId, value: "stored-device")
        let service = TogglyService(config: TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid",
            refreshInterval: 60, storage: storage, enableLiveUpdates: false, enableTelemetry: false))
        await service.setNetworkState(.disconnected)
        let initialize = Task { await service.initialize() }
        await fulfillment(of: [paused], timeout: 2)
        await service.dispose()
        await storage.resume()
        await initialize.value
        let debug = await service.getDebugInfo()
        let initialized = await service.initialized
        XCTAssertFalse(initialized)
        XCTAssertFalse(debug.syncServiceRunning)
    }

    func testFirstRequestEncodesIdentityWithoutInjectingParameters() async throws {
        let service = TogglyService(config: TogglyConfig(
            appKey: "app", baseURI: "https://initial-context.invalid", identity: "user&123+?#é",
            refreshInterval: 0, enableLiveUpdates: false, enableTelemetry: false))
        await service.initialize()
        let request = try XCTUnwrap(InitialContextURLProtocol.requests.first)
        let items = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items, [URLQueryItem(name: "u", value: "user&123+?#é")])
        XCTAssertEqual(InitialContextURLProtocol.requests.count, 1)
        await service.dispose()
    }
    func testStartupSnapshotsAndNormalizesAllFieldsBeforeOneRequest() async throws {
        var groups = [" beta ", "team a", "a&b+?", " "]
        var claims = ["plan": "pro+&=é", "": "ignored", "empty": ""]
        let storage = MemoryStorage()
        await storage.set(TogglyStorageKeys.deviceId, value: "stale-user")
        let config = TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid",
            identity: "user&123", refreshInterval: 0, storage: storage, enableLiveUpdates: false,
            groups: groups, claims: claims, enableTelemetry: false)
        groups.append("mutated")
        claims["plan"] = "mutated"
        let service = TogglyService(config: config)
        await service.initialize()
        XCTAssertEqual(InitialContextURLProtocol.requests.count, 1)
        let url = try XCTUnwrap(InitialContextURLProtocol.requests.first?.url)
        let items = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items.filter { $0.name == "u" }.map(\.value), ["user&123"])
        XCTAssertEqual(items.filter { $0.name == "g" }.map(\.value), ["beta", "team a", "a&b+?"])
        XCTAssertEqual(items.filter { $0.name.hasPrefix("claim.") }, [URLQueryItem(name: "claim.plan", value: "pro+&=é")])
        XCTAssertTrue(url.absoluteString.contains("%2B"))
        await service.dispose()
    }

    func testClaimsCapDropsAlphabeticallyLastNonemptyTypes() async throws {
        var claims = Dictionary(uniqueKeysWithValues: (0..<25).map { (String(format: "c%02d", $0), "v") })
        claims[""] = "ignored"
        claims["a"] = ""
        let service = TogglyService(config: TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid",
            identity: "", refreshInterval: 0, enableLiveUpdates: false, claims: claims, enableTelemetry: false))
        await service.initialize()
        let items = URLComponents(url: InitialContextURLProtocol.requests[0].url!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertEqual(items.filter { $0.name.hasPrefix("claim.") }.map(\.name), (0..<20).map { String(format: "claim.c%02d", $0) })
        XCTAssertEqual(items.first, URLQueryItem(name: "u", value: ""))
        await service.dispose()
    }

    func testOmittedIdentityUsesStoredDeviceAndEmptyContextAddsNoParameters() async throws {
        let storage = MemoryStorage()
        await storage.set(TogglyStorageKeys.deviceId, value: "device")
        for explicitEmpty in [false, true] {
            let config = explicitEmpty
                ? TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid", refreshInterval: 0,
                    storage: storage, enableLiveUpdates: false, groups: [], claims: [:], enableTelemetry: false)
                : TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid", refreshInterval: 0,
                    storage: storage, enableLiveUpdates: false, enableTelemetry: false)
            let service = TogglyService(config: config)
            await service.initialize()
            let items = URLComponents(url: InitialContextURLProtocol.requests.last!.url!, resolvingAgainstBaseURL: false)!.queryItems!
            XCTAssertEqual(items, [URLQueryItem(name: "u", value: "device")])
            await service.dispose()
        }
    }

    func testCacheAndRevisionCannotCrossInitialContext() async throws {
        let storage = MemoryStorage()
        func service(_ groups: [String], _ claims: [String: String]) -> TogglyService {
            TogglyService(config: TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid",
                identity: "same", featureDefaults: ["targeted": false], refreshInterval: 0,
                useSignedDefinitions: true, storage: storage, enableLiveUpdates: false, groups: groups, claims: claims, enableTelemetry: false))
        }
        let original = service(["a,b"], ["plan": "pro&x=y"])
        let fetched = await original.initialize()
        XCTAssertEqual(fetched.flags["targeted"], true)
        await original.refresh()
        XCTAssertEqual(InitialContextURLProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"), "same-revision")
        await original.dispose()
        InitialContextURLProtocol.fail = true
        for (groups, claims, expected) in [
            (["a,b"], ["plan": "pro&x=y"], true),
            (["a", "b"], ["plan": "pro&x=y"], false),
            (["a,b"], ["plan": "pro", "x": "y"], false),
            ([], [:], false)
        ] {
            let next = service(groups, claims)
            let response = await next.initialize()
            XCTAssertEqual(response.flags["targeted"], expected)
            XCTAssertNil(InitialContextURLProtocol.requests.last?.value(forHTTPHeaderField: "If-None-Match"))
            await next.dispose()
        }
    }

    func testLegacyIdentityCacheIsRejectedForTargetingAndClearedForEmptyContext() async throws {
        let storage = MemoryStorage()
        let legacy = TogglyFeatureFlagsCache(identity: "same", flags: "{\"targeted\":true}")
        let key = TogglyStorageKeys.featureFlagsCache + "0035c066"
        await storage.set(key, value: String(data: try JSONEncoder().encode(legacy), encoding: .utf8)!)
        InitialContextURLProtocol.fail = true
        for groups in [["beta"], []] {
            let service = TogglyService(config: TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid",
                identity: "same", featureDefaults: ["targeted": false], refreshInterval: 0,
                storage: storage, enableLiveUpdates: false, groups: groups, enableTelemetry: false))
            let response = await service.initialize()
            XCTAssertEqual(response.flags["targeted"], groups.isEmpty)
            if groups.isEmpty {
                await service.clearCache()
                let refreshed = await service.refresh()
                XCTAssertEqual(refreshed.flags["targeted"], false)
            }
            await service.dispose()
        }
    }

}
