import XCTest
@testable import TogglyCore

/// Exercises public flag evaluation against a mocked Toggly definitions HTTP
/// contract (`evaluated-signed` boolean + entity-gate payloads).
///
/// This Apple client SDK consumes *server-evaluated* definitions. It does not
/// implement local filter-parity evaluation or catalog-local variant allocation,
/// so `docs/filter-parity/fixtures` and `variant-allocator-corpus/cases.json`
/// are intentionally not replayed here (see SUPPORT_MATRIX / PR notes).
private final class ApiContractURLProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var responseBody = "{}"
    static var statusCode = 200
    static var etag: String?
    static var fail = false

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "api-contract.invalid"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append(request)
        if Self.fail {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        var headers: [String: String] = ["Content-Type": "application/json"]
        if let etag = Self.etag {
            headers["ETag"] = etag
        }
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(
                url: request.url!,
                statusCode: Self.statusCode,
                httpVersion: nil,
                headerFields: headers
            )!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: Data(Self.responseBody.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ApiContractEvaluationTests: XCTestCase {
    override func setUp() {
        super.setUp()
        ApiContractURLProtocol.requests = []
        ApiContractURLProtocol.responseBody = "{}"
        ApiContractURLProtocol.statusCode = 200
        ApiContractURLProtocol.etag = "\"rev-1\""
        ApiContractURLProtocol.fail = false
        URLProtocol.registerClass(ApiContractURLProtocol.self)
    }

    override func tearDown() {
        URLProtocol.unregisterClass(ApiContractURLProtocol.self)
        clearRegisteredContexts()
        super.tearDown()
    }

    private func makeService(responseBody: String, identity: String = "alice") -> TogglyService {
        ApiContractURLProtocol.responseBody = responseBody
        return TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://api-contract.invalid",
            identity: identity,
            featureDefaults: [
                "NewCheckout": false,
                "LegacyBanner": false,
                "ColorGated": false
            ],
            refreshInterval: 0,
            enableLiveUpdates: false,
            groups: ["beta"],
            claims: ["plan": "pro"],
            enableTelemetry: false
        ))
    }

    /// Realistic evaluated-signed payload: booleans mixed with entity gates.
    private var mixedDefinitionsPayload: String {
        """
        {
          "NewCheckout": true,
          "LegacyBanner": false,
          "ColorGated": {
            "requirement": "all",
            "rules": [
              {"property": "Color", "op": "eq", "value": "red"}
            ]
          }
        }
        """
    }

    func testPublicEntryPointsEvaluateFetchedDefinitionsPayload() async throws {
        let service = makeService(responseBody: mixedDefinitionsPayload)
        let response = await service.initialize()
        XCTAssertEqual(response.status, .fetched)
        XCTAssertEqual(response.flags["NewCheckout"], true)
        XCTAssertEqual(response.flags["LegacyBanner"], false)
        // Entity gates flatten to false without a matching context for public flags map.
        XCTAssertEqual(response.flags["ColorGated"], false)

        let request = try XCTUnwrap(ApiContractURLProtocol.requests.first)
        XCTAssertEqual(request.url?.path, "/evaluated-signed/app/Production")
        let items = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items.first(where: { $0.name == "u" })?.value, "alice")
        XCTAssertEqual(items.first(where: { $0.name == "g" })?.value, "beta")
        XCTAssertEqual(items.first(where: { $0.name == "claim.plan" })?.value, "pro")

        XCTAssertTrue(await service.isFeatureOn("NewCheckout"))
        XCTAssertTrue(await service.isEnabled("NewCheckout"))
        XCTAssertFalse(await service.isFeatureOn("LegacyBanner"))
        XCTAssertTrue(await service.isFeatureOff("LegacyBanner"))
        XCTAssertFalse(await service.isEnabled("missing-feature"))

        let allGate = await service.evaluateFeatureGate(
            featureKeys: ["NewCheckout", "LegacyBanner"],
            requirement: .all
        )
        let anyGate = await service.evaluateFeatureGate(
            featureKeys: ["NewCheckout", "LegacyBanner"],
            requirement: .any
        )
        XCTAssertFalse(allGate)
        XCTAssertTrue(anyGate)

        await service.dispose()
    }

    func testEntityGateRequiresMatchingContextThroughPublicIsEnabled() async {
        let service = makeService(responseBody: mixedDefinitionsPayload)
        await service.initialize()

        XCTAssertFalse(await service.isEnabled("ColorGated"))
        XCTAssertFalse(await service.isEnabled(
            "ColorGated",
            context: TogglyEntityContext(kind: "Order", key: "1", attributes: ["Color": "blue"])
        ))
        XCTAssertTrue(await service.isEnabled(
            "ColorGated",
            context: TogglyEntityContext(kind: "Order", key: "1", attributes: ["Color": "red"])
        ))

        await service.dispose()
    }

    func testNotModifiedKeepsPreviouslyEvaluatedFlags() async {
        let service = makeService(responseBody: mixedDefinitionsPayload)
        let first = await service.initialize()
        XCTAssertEqual(first.status, .fetched)
        XCTAssertTrue(await service.isFeatureOn("NewCheckout"))

        ApiContractURLProtocol.statusCode = 304
        ApiContractURLProtocol.responseBody = ""
        await service.refresh()
        XCTAssertTrue(await service.isFeatureOn("NewCheckout"))
        XCTAssertFalse(await service.isFeatureOn("LegacyBanner"))

        await service.dispose()
    }

    func testNetworkFailureFallsBackToDefaultsWithoutChangingPublicAPI() async {
        ApiContractURLProtocol.fail = true
        let service = makeService(responseBody: "{}")
        let response = await service.initialize()
        XCTAssertEqual(response.status, .defaults)
        XCTAssertFalse(await service.isFeatureOn("NewCheckout"))
        XCTAssertFalse(await service.isFeatureOn("LegacyBanner"))
        await service.dispose()
    }
}
