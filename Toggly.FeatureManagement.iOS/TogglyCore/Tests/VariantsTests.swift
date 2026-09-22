import XCTest
@testable import TogglyCore

private final class VariantsURLProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var responseBody = "{}"
    static var statusCode = 200
    static var fail = false

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "variants.invalid"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.requests.append(request)
        if Self.fail {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: nil, headerFields: nil)!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: Data(Self.responseBody.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class VariantsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        VariantsURLProtocol.requests = []
        VariantsURLProtocol.responseBody = "{}"
        VariantsURLProtocol.statusCode = 200
        VariantsURLProtocol.fail = false
        URLProtocol.registerClass(VariantsURLProtocol.self)
    }
    override func tearDown() {
        URLProtocol.unregisterClass(VariantsURLProtocol.self)
        super.tearDown()
    }

    private func makeService(
        responseBody: String,
        storage: TogglyStorage? = nil,
        verifySignatures: Bool = false
    ) -> TogglyService {
        VariantsURLProtocol.responseBody = responseBody
        return TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://variants.invalid",
            identity: "alice",
            refreshInterval: 0,
            verifySignatures: verifySignatures,
            enableVariants: true,
            storage: storage,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
    }

    // MARK: - URL routing

    func testEnableVariantsRoutesToVariantsEndpointWithUserIdParam() async throws {
        let service = makeService(responseBody: "{}")
        await service.initialize()

        let request = try XCTUnwrap(VariantsURLProtocol.requests.first)
        XCTAssertEqual(request.url?.path, "/evaluated-variants-signed/app/Production")
        let items = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items, [URLQueryItem(name: "userId", value: "alice")])
        await service.dispose()
    }

    func testDisabledVariantsRoutesToEvaluatedSignedWithUParam() async throws {
        let service = TogglyService(config: TogglyConfig(
            appKey: "app", baseURI: "https://variants.invalid", identity: "alice",
            refreshInterval: 0, enableVariants: false, enableLiveUpdates: false, enableTelemetry: false
        ))
        await service.initialize()
        let request = try XCTUnwrap(VariantsURLProtocol.requests.first)
        XCTAssertEqual(request.url?.path, "/evaluated-signed/app/Production")
        let items = try XCTUnwrap(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems)
        XCTAssertEqual(items, [URLQueryItem(name: "u", value: "alice")])
        await service.dispose()
    }

    // MARK: - getVariant / getVariantValue semantics

    func testGetVariantReturnsAssignedVariantWithConfigurationValue() async {
        let service = makeService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment", "configurationValue": {"color": "blue"}}}
        """)
        await service.initialize()

        let result = await service.getVariant("checkout")
        XCTAssertEqual(result?.name, "Treatment")
        XCTAssertEqual((result?.configurationValue as? [String: String])?["color"], "blue")

        let value = await service.getVariantValue("checkout")
        XCTAssertEqual((value as? [String: String])?["color"], "blue")
        await service.dispose()
    }

    func testGetVariantReturnsNilWhenDisabled() async {
        let service = makeService(responseBody: """
        {"checkout": {"enabled": false, "variant": "Treatment"}}
        """)
        await service.initialize()

        let result = await service.getVariant("checkout")
        XCTAssertNil(result)
        await service.dispose()
    }

    func testGetVariantReturnsNilWhenEnabledWithoutVariant() async {
        let service = makeService(responseBody: """
        {"checkout": {"enabled": true}}
        """)
        await service.initialize()

        let result = await service.getVariant("checkout")
        XCTAssertNil(result)
        await service.dispose()
    }

    func testGetVariantReturnsNilForUnknownFeature() async {
        let service = makeService(responseBody: "{}")
        await service.initialize()

        let result = await service.getVariant("missing")
        XCTAssertNil(result)
        await service.dispose()
    }

    func testGetVariantReturnsNilWhenVariantsDisabled() async {
        let service = TogglyService(config: TogglyConfig(
            appKey: "app", baseURI: "https://variants.invalid", identity: "alice",
            refreshInterval: 0, enableVariants: false, enableLiveUpdates: false, enableTelemetry: false
        ))
        await service.initialize()

        let result = await service.getVariant("checkout")
        XCTAssertNil(result)
        await service.dispose()
    }

    // MARK: - Boolean gate stays consistent with variant assignment

    func testIsFeatureOnReflectsVariantEnabledFlag() async {
        let service = makeService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment"}, "banner": {"enabled": false}}
        """)
        await service.initialize()

        let checkoutOn = await service.isFeatureOn("checkout")
        let bannerOn = await service.isFeatureOn("banner")
        XCTAssertTrue(checkoutOn)
        XCTAssertFalse(bannerOn)
        await service.dispose()
    }

    // MARK: - Caching round-trip

    func testCachedVariantsSurviveOfflineRestartWithSameStorage() async throws {
        let storage = MemoryStorage()
        let online = makeService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment", "configurationValue": 42}}
        """, storage: storage)
        let initial = await online.initialize()
        XCTAssertEqual(initial.status, .fetched)
        await online.dispose()

        VariantsURLProtocol.fail = true
        let offline = makeService(responseBody: "{}", storage: storage)
        let response = await offline.initialize()
        XCTAssertEqual(response.flags["checkout"], true)

        let result = await offline.getVariant("checkout")
        XCTAssertEqual(result?.name, "Treatment")
        XCTAssertEqual(result?.configurationValue as? Int, 42)
        await offline.dispose()
    }

    func testClearCacheResetsVariantsToDefaults() async {
        let service = makeService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment"}}
        """)
        await service.initialize()
        let before = await service.getVariant("checkout")
        XCTAssertEqual(before?.name, "Treatment")

        await service.clearCache()
        let afterClear = await service.getVariant("checkout")
        XCTAssertNil(afterClear)
        await service.dispose()
    }

    func testSetIdentityResetsVariantsUntilNextFetch() async {
        let service = makeService(responseBody: """
        {"checkout": {"enabled": true, "variant": "Treatment"}}
        """)
        await service.initialize()
        let before = await service.getVariant("checkout")
        XCTAssertEqual(before?.name, "Treatment")

        VariantsURLProtocol.responseBody = """
        {"checkout": {"enabled": true, "variant": "Control"}}
        """
        await service.setIdentity("bob")
        let result = await service.getVariant("checkout")
        XCTAssertEqual(result?.name, "Control")
        await service.dispose()
    }

    // MARK: - Malformed payloads default safely

    func testMalformedVariantEntryDefaultsToDisabled() async {
        let service = makeService(responseBody: """
        {"checkout": "not-an-object"}
        """)
        await service.initialize()

        let checkoutOn = await service.isFeatureOn("checkout")
        let variant = await service.getVariant("checkout")
        XCTAssertFalse(checkoutOn)
        XCTAssertNil(variant)
        await service.dispose()
    }
}
