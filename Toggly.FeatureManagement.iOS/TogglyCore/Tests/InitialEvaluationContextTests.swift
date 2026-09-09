import XCTest
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
    func testFirstRequestEncodesIdentityWithoutInjectingParameters() async throws {
        let service = TogglyService(config: TogglyConfig(
            appKey: "app", baseURI: "https://initial-context.invalid", identity: "user&123+?#é",
            refreshInterval: 0, enableLiveUpdates: false))
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
            groups: groups, claims: claims)
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
            identity: "", refreshInterval: 0, enableLiveUpdates: false, claims: claims))
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
                    storage: storage, enableLiveUpdates: false, groups: [], claims: [:])
                : TogglyConfig(appKey: "app", baseURI: "https://initial-context.invalid", refreshInterval: 0,
                    storage: storage, enableLiveUpdates: false)
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
                useSignedDefinitions: true, storage: storage, enableLiveUpdates: false, groups: groups, claims: claims))
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
                storage: storage, enableLiveUpdates: false, groups: groups))
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
