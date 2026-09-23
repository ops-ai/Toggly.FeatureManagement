import CryptoKit
import XCTest
@testable import TogglyCore

private final class VariantsURLProtocol: URLProtocol {
    static var requests: [URLRequest] = []
    static var responseBody = "{}"
    /// Served from `/.well-known/jwks` when set; falls back to `responseBody` otherwise
    /// (most tests never fetch JWKS, so a single body is enough for them).
    static var jwksBody: String?
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
        let body = request.url?.path == "/.well-known/jwks" ? (Self.jwksBody ?? Self.responseBody) : Self.responseBody
        client?.urlProtocol(
            self,
            didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: nil, headerFields: nil)!,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class VariantsTests: XCTestCase {
    override func setUp() {
        super.setUp()
        VariantsURLProtocol.requests = []
        VariantsURLProtocol.responseBody = "{}"
        VariantsURLProtocol.jwksBody = nil
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

    // MARK: - Signed variants cache (cold start)

    private struct SignedFixture {
        let defs: String
        let timestamp: Int64
        let signatureBase64: String
        let jwk: Jwk
    }

    /// CryptoKit P256 double-SHA256 fixture builder, mirrored from
    /// `FeatureFlagsCacheTests.makeSignedFixture` for the variants cache-verify tests below.
    private func makeSignedFixture(defs: String, timestamp: Int64) throws -> SignedFixture {
        let privateKey = P256.Signing.PrivateKey()
        let publicBytes = privateKey.publicKey.x963Representation
        let xBytes = publicBytes.subdata(in: 1..<33)
        let yBytes = publicBytes.subdata(in: 33..<65)
        let x = SignedDefsVerify.base64URLEncode(xBytes)
        let y = SignedDefsVerify.base64URLEncode(yBytes)
        let kid = try SignedDefsVerify.computeKid(x: x, y: y)

        let payload = "\(defs)|\(timestamp)"
        guard let payloadData = payload.data(using: .utf8) else {
            throw SignedDefsVerifyError.invalidEnvelope
        }
        let first = SHA256.hash(data: payloadData)
        let digest = SHA256.hash(data: Data(first))
        let signature = try privateKey.signature(for: digest)

        return SignedFixture(
            defs: defs,
            timestamp: timestamp,
            signatureBase64: signature.rawRepresentation.base64EncodedString(),
            jwk: Jwk(kid: kid, x: x, y: y)
        )
    }

    /// Reproduces `TogglyService.contextIdentity` (no instanceId, empty groups/claims) so
    /// the test can address the same `v3:variants:` cache key the service reads/writes.
    private func variantsCacheKey(baseURI: String, appKey: String, environment: String = "Production", identity: String) throws -> String {
        let parts: [[String]] = [[baseURI, appKey, environment, identity], [], []]
        let contextData = try JSONEncoder().encode(parts)
        let context = String(data: contextData, encoding: .utf8)!
        let hash = SHA256.hash(data: Data(context.utf8)).map { String(format: "%02x", $0) }.joined()
        return TogglyStorageKeys.featureFlagsCache + "v3:variants:" + hash
    }

    private func makeVariantsCacheEntry(
        identity: String,
        defsRaw: String,
        timestamp: Int64? = nil,
        signature: String? = nil,
        keyId: String? = nil
    ) throws -> String {
        let cache = TogglyFeatureFlagsCache(identity: identity, flags: defsRaw, timestamp: timestamp, signature: signature, keyId: keyId)
        return String(data: try JSONEncoder().encode(cache), encoding: .utf8)!
    }

    private func makeSignedVariantsService(
        identity: String = "user-1",
        baseURI: String = "https://127.0.0.1:9",
        appKey: String = "app",
        storage: TogglyStorage,
        maxSignatureAgeSeconds: Int64? = nil
    ) -> TogglyService {
        TogglyService(config: TogglyConfig(
            appKey: appKey,
            baseURI: baseURI,
            identity: identity,
            featureDefaults: [:],
            refreshInterval: 0,
            verifySignatures: true,
            enableVariants: true,
            connectTimeout: 1,
            requestTimeout: 1,
            storage: storage,
            enableLiveUpdates: false,
            maxSignatureAgeSeconds: maxSignatureAgeSeconds,
            enableTelemetry: false
        ))
    }

    func testColdStartTrustsSignedVariantsCacheWithJwksAvailable() async throws {
        let identity = "user-1"
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment","configurationValue":{"color":"blue"}}}"#
        let fixture = try makeSignedFixture(defs: defsRaw, timestamp: Int64(Date().timeIntervalSince1970))
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(
            identity: identity, defsRaw: defsRaw, timestamp: fixture.timestamp,
            signature: fixture.signatureBase64, keyId: fixture.jwk.kid
        ))
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = makeSignedVariantsService(identity: identity, storage: storage)
        _ = await service.initialize()
        let variant = await service.getVariant("checkout")
        XCTAssertEqual(variant?.name, "Treatment")
        XCTAssertEqual((variant?.configurationValue as? [String: String])?["color"], "blue")
    }

    func testColdStartClearsSignedVariantsCacheOnInvalidSignature() async throws {
        let identity = "user-1"
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment"}}"#
        let good = try makeSignedFixture(defs: defsRaw, timestamp: Int64(Date().timeIntervalSince1970))
        let other = try makeSignedFixture(defs: defsRaw, timestamp: good.timestamp)
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        // Valid envelope shape, but the signature came from a different key.
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(
            identity: identity, defsRaw: defsRaw, timestamp: good.timestamp,
            signature: other.signatureBase64, keyId: good.jwk.kid
        ))
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [good.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = makeSignedVariantsService(identity: identity, storage: storage)
        _ = await service.initialize()
        let variant = await service.getVariant("checkout")
        XCTAssertNil(variant)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartClearsSignedVariantsCacheOnUnknownKid() async throws {
        let identity = "user-1"
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment"}}"#
        let fixture = try makeSignedFixture(defs: defsRaw, timestamp: Int64(Date().timeIntervalSince1970))
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(
            identity: identity, defsRaw: defsRaw, timestamp: fixture.timestamp,
            signature: fixture.signatureBase64, keyId: "unknown-kid-not-in-jwks"
        ))
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = makeSignedVariantsService(identity: identity, storage: storage)
        _ = await service.initialize()
        let variant = await service.getVariant("checkout")
        XCTAssertNil(variant)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartClearsSignedVariantsCacheOnMissingSignatureMetadata() async throws {
        let identity = "user-1"
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment"}}"#
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        // No timestamp/signature/keyId: envelope metadata missing entirely.
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(identity: identity, defsRaw: defsRaw))

        let service = makeSignedVariantsService(identity: identity, storage: storage)
        _ = await service.initialize()
        let variant = await service.getVariant("checkout")
        XCTAssertNil(variant)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartSoftFailsAndTrustsVariantsCacheWhenJwksUnavailable() async throws {
        let identity = "user-1"
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment"}}"#
        let fixture = try makeSignedFixture(defs: defsRaw, timestamp: Int64(Date().timeIntervalSince1970))
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(
            identity: identity, defsRaw: defsRaw, timestamp: fixture.timestamp,
            signature: fixture.signatureBase64, keyId: fixture.jwk.kid
        ))
        // No JWKS persisted, and the base URI is unreachable: soft-fail trusts the cache.

        let service = makeSignedVariantsService(identity: identity, storage: storage)
        _ = await service.initialize()
        let variant = await service.getVariant("checkout")
        XCTAssertEqual(variant?.name, "Treatment")
    }

    func testColdStartClearsStaleSignedVariantsCache() async throws {
        let identity = "user-1"
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment"}}"#
        let fixture = try makeSignedFixture(defs: defsRaw, timestamp: 1_000)
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(
            identity: identity, defsRaw: defsRaw, timestamp: fixture.timestamp,
            signature: fixture.signatureBase64, keyId: fixture.jwk.kid
        ))
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = makeSignedVariantsService(identity: identity, storage: storage, maxSignatureAgeSeconds: 60)
        _ = await service.initialize()
        let variant = await service.getVariant("checkout")
        XCTAssertNil(variant)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartUsesDefaultsWhenCachedVariantsAreNotJson() async throws {
        let identity = "user-1"
        let storage = MemoryStorage()
        let cacheKey = try variantsCacheKey(baseURI: "https://127.0.0.1:9", appKey: "app", identity: identity)
        await storage.set(cacheKey, value: try makeVariantsCacheEntry(identity: identity, defsRaw: "not-json"))

        let service = TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://127.0.0.1:9",
            identity: identity,
            featureDefaults: ["checkout": false],
            refreshInterval: 0,
            verifySignatures: false,
            enableVariants: true,
            connectTimeout: 1,
            requestTimeout: 1,
            storage: storage,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
        _ = await service.initialize()
        let isOn = await service.isFeatureOn("checkout")
        XCTAssertFalse(isOn)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    // MARK: - Live fetch with a signed envelope

    func testLiveFetchVerifiesSignedVariantsEnvelope() async throws {
        let defsRaw = #"{"checkout":{"enabled":true,"variant":"Treatment","configurationValue":{"color":"blue"}}}"#
        let timestamp = Int64(Date().timeIntervalSince1970)
        let fixture = try makeSignedFixture(defs: defsRaw, timestamp: timestamp)
        VariantsURLProtocol.responseBody = #"{"defs":\#(defsRaw),"signature":"\#(fixture.signatureBase64)","timestamp":\#(timestamp),"kid":"\#(fixture.jwk.kid)"}"#
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        VariantsURLProtocol.jwksBody = String(data: jwksData, encoding: .utf8)!

        let service = TogglyService(config: TogglyConfig(
            appKey: "app",
            baseURI: "https://variants.invalid",
            identity: "alice",
            refreshInterval: 0,
            verifySignatures: true,
            enableVariants: true,
            enableLiveUpdates: false,
            enableTelemetry: false
        ))
        let response = await service.initialize()
        XCTAssertEqual(response.status, .fetched)
        let variant = await service.getVariant("checkout")
        XCTAssertEqual(variant?.name, "Treatment")
        XCTAssertEqual((variant?.configurationValue as? [String: String])?["color"], "blue")
        await service.dispose()
    }

    // MARK: - Telemetry for variant checks

    private actor VariantTelemetryRequests {
        var bodies: [[String: Any]] = []
        func append(_ request: URLRequest) throws {
            let body = try XCTUnwrap(request.httpBody)
            bodies.append(try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any]))
        }
    }

    func testGetVariantRecordsTelemetryLabeledByAssignmentState() async throws {
        let requests = VariantTelemetryRequests()
        var config = TogglyConfig(
            appKey: "app",
            baseURI: "https://variants.invalid",
            identity: "alice",
            refreshInterval: 0,
            enableVariants: true,
            enableLiveUpdates: false
        )
        VariantsURLProtocol.responseBody = """
        {"checkout": {"enabled": true, "variant": "Treatment"}, "banner": {"enabled": false}, "promo": {"enabled": true}}
        """
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.initialize()

        _ = await service.getVariant("checkout")
        _ = await service.getVariant("banner")
        _ = await service.getVariant("promo")
        await service.flushTelemetry()

        let bodies = await requests.bodies
        XCTAssertEqual(bodies.count, 1)
        let features = try XCTUnwrap(bodies.first?["f"] as? [String: [String: [Int]]])
        XCTAssertEqual(features["checkout"]?["Treatment"], [1])
        XCTAssertEqual(features["banner"]?["disabled"], [1])
        XCTAssertEqual(features["promo"]?["enabled"], [1])
        await service.dispose()
    }

    func testGetVariantSkipsTelemetryWhenRecordCheckIsFalse() async throws {
        let requests = VariantTelemetryRequests()
        var config = TogglyConfig(
            appKey: "app",
            baseURI: "https://variants.invalid",
            identity: "alice",
            refreshInterval: 0,
            enableVariants: true,
            enableLiveUpdates: false
        )
        VariantsURLProtocol.responseBody = """
        {"checkout": {"enabled": true, "variant": "Treatment"}}
        """
        config.telemetryTransport = { request in
            try await requests.append(request)
            return HTTPURLResponse(url: request.url!, statusCode: 202, httpVersion: nil, headerFields: nil)!
        }
        let service = TogglyService(config: config)
        await service.initialize()

        _ = await service.getVariant("checkout", recordCheck: false)
        await service.flushTelemetry()

        let bodies = await requests.bodies
        XCTAssertTrue(bodies.isEmpty)
        await service.dispose()
    }

    // MARK: - Direct unit tests: VariantResult / parseEvaluatedVariantDefs

    func testVariantResultDescriptionAndDebugDescriptionIncludeName() {
        let result = VariantResult(name: "Treatment", configurationValue: ["color": "blue"])
        XCTAssertEqual(result.description, "VariantResult(name: Treatment)")
        XCTAssertEqual(result.debugDescription, result.description)
    }

    func testParseEvaluatedVariantDefsThrowsOnArrayTopLevel() {
        XCTAssertThrowsError(try parseEvaluatedVariantDefs(from: "[]"))
        XCTAssertThrowsError(try parseEvaluatedVariantDefs(from: Data("[]".utf8)))
    }

    func testParseEvaluatedVariantDefsThrowsOnNonObjectScalarTopLevel() {
        XCTAssertThrowsError(try parseEvaluatedVariantDefs(from: "42"))
    }

    func testParseEvaluatedVariantDefsStringOverloadParsesValidJson() throws {
        let defs = try parseEvaluatedVariantDefs(from: #"{"checkout":{"enabled":true,"variant":"Treatment","configurationValue":42}}"#)
        XCTAssertEqual(defs["checkout"]?.enabled, true)
        XCTAssertEqual(defs["checkout"]?.variant, "Treatment")
        XCTAssertEqual(defs["checkout"]?.configurationValue as? Int, 42)
    }
}
