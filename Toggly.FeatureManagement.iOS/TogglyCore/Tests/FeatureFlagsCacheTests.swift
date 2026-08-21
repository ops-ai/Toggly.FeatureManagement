import CryptoKit
import Foundation
import XCTest
@testable import TogglyCore

final class FeatureFlagsCacheTests: XCTestCase {
    func testDecodesLegacyCacheWithoutEnvelopeMetadata() throws {
        let legacy = Data(#"{"identity":"user-1","flags":"{\"A\":true}"}"#.utf8)
        let cache = try JSONDecoder().decode(TogglyFeatureFlagsCache.self, from: legacy)

        XCTAssertEqual(cache.identity, "user-1")
        XCTAssertEqual(cache.flags, #"{"A":true}"#)
        XCTAssertNil(cache.timestamp)
        XCTAssertNil(cache.signature)
        XCTAssertNil(cache.keyId)
    }

    func testRoundTripsEnvelopeMetadata() throws {
        let cache = TogglyFeatureFlagsCache(
            identity: "user-1",
            flags: #"{"A":true}"#,
            timestamp: 1_700_000_000,
            signature: "sig",
            keyId: "kid"
        )
        let encoded = try JSONEncoder().encode(cache)
        let decoded = try JSONDecoder().decode(TogglyFeatureFlagsCache.self, from: encoded)

        XCTAssertEqual(decoded.identity, cache.identity)
        XCTAssertEqual(decoded.flags, cache.flags)
        XCTAssertEqual(decoded.timestamp, cache.timestamp)
        XCTAssertEqual(decoded.signature, cache.signature)
        XCTAssertEqual(decoded.keyId, cache.keyId)
    }

    func testColdStartClearsCacheOnInvalidSignatureWhenJwksAvailable() async throws {
        let good = try makeSignedFixture(
            defs: #"{"PresalePhotos":true}"#,
            timestamp: Int64(Date().timeIntervalSince1970)
        )
        let other = try makeSignedFixture(
            defs: #"{"PresalePhotos":true}"#,
            timestamp: good.timestamp
        )
        let identity = "user-1"
        let storage = MemoryStorage()
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashIdentity(identity)
        // Valid envelope shape, but signature from a different key → invalidSignature
        let cache = TogglyFeatureFlagsCache(
            identity: identity,
            flags: good.defs,
            timestamp: good.timestamp,
            signature: other.signatureBase64,
            keyId: good.jwk.kid
        )
        let cacheData = try JSONEncoder().encode(cache)
        await storage.set(cacheKey, value: String(data: cacheData, encoding: .utf8)!)
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [good.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: true,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertFalse(isOn)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartReVerifiesSignedCacheWithPersistedJwks() async throws {
        let fixture = try makeSignedFixture(
            defs: #"{"PresalePhotos":true,"PuppySales":false}"#,
            timestamp: Int64(Date().timeIntervalSince1970)
        )
        let identity = "user-1"
        let storage = MemoryStorage()
        let cache = TogglyFeatureFlagsCache(
            identity: identity,
            flags: fixture.defs,
            timestamp: fixture.timestamp,
            signature: fixture.signatureBase64,
            keyId: fixture.jwk.kid
        )
        let cacheData = try JSONEncoder().encode(cache)
        await storage.set(
            TogglyStorageKeys.featureFlagsCache + hashIdentity(identity),
            value: String(data: cacheData, encoding: .utf8)!
        )
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: true,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        let response = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        let isOff = await service.isFeatureOn("PuppySales")

        XCTAssertEqual(response.flags["PresalePhotos"], true)
        XCTAssertEqual(response.flags["PuppySales"], false)
        XCTAssertTrue(isOn)
        XCTAssertFalse(isOff)
    }

    func testColdStartSoftFailsWhenJwksUnavailable() async throws {
        let fixture = try makeSignedFixture(
            defs: #"{"PresalePhotos":true}"#,
            timestamp: Int64(Date().timeIntervalSince1970)
        )
        let identity = "user-1"
        let storage = MemoryStorage()
        let cache = TogglyFeatureFlagsCache(
            identity: identity,
            flags: fixture.defs,
            timestamp: fixture.timestamp,
            signature: fixture.signatureBase64,
            keyId: fixture.jwk.kid
        )
        let cacheData = try JSONEncoder().encode(cache)
        await storage.set(
            TogglyStorageKeys.featureFlagsCache + hashIdentity(identity),
            value: String(data: cacheData, encoding: .utf8)!
        )

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: true,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertTrue(isOn)
    }

    func testColdStartClearsCacheOnUnknownKidWhenJwksAvailable() async throws {
        let fixture = try makeSignedFixture(
            defs: #"{"PresalePhotos":true}"#,
            timestamp: Int64(Date().timeIntervalSince1970)
        )
        let identity = "user-1"
        let storage = MemoryStorage()
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashIdentity(identity)
        let cache = TogglyFeatureFlagsCache(
            identity: identity,
            flags: fixture.defs,
            timestamp: fixture.timestamp,
            signature: fixture.signatureBase64,
            keyId: "unknown-kid-not-in-jwks"
        )
        let cacheData = try JSONEncoder().encode(cache)
        await storage.set(cacheKey, value: String(data: cacheData, encoding: .utf8)!)
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: true,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertFalse(isOn)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartUsesDefaultsWhenCachedFlagsAreNotJson() async throws {
        let identity = "user-1"
        let storage = MemoryStorage()
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashIdentity(identity)
        let cache = TogglyFeatureFlagsCache(identity: identity, flags: "not-json")
        let cacheData = try JSONEncoder().encode(cache)
        await storage.set(cacheKey, value: String(data: cacheData, encoding: .utf8)!)

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: false,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertFalse(isOn)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testColdStartClearsStaleSignedCache() async throws {
        let fixture = try makeSignedFixture(
            defs: #"{"PresalePhotos":true}"#,
            timestamp: 1_000
        )
        let identity = "user-1"
        let storage = MemoryStorage()
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashIdentity(identity)
        let cache = TogglyFeatureFlagsCache(
            identity: identity,
            flags: fixture.defs,
            timestamp: fixture.timestamp,
            signature: fixture.signatureBase64,
            keyId: fixture.jwk.kid
        )
        let cacheData = try JSONEncoder().encode(cache)
        await storage.set(cacheKey, value: String(data: cacheData, encoding: .utf8)!)
        let jwksData = try JSONEncoder().encode(JwkSet(keys: [fixture.jwk]))
        await storage.set(TogglyStorageKeys.jwks, value: String(data: jwksData, encoding: .utf8)!)

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: true,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false,
                maxSignatureAgeSeconds: 60
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertFalse(isOn)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    func testUnsignedCacheIsTrustedWhenVerificationIsOff() async throws {
        let identity = "user-1"
        let storage = MemoryStorage()
        await storage.set(
            TogglyStorageKeys.featureFlagsCache + hashIdentity(identity),
            value: #"{"identity":"user-1","flags":"{\"PresalePhotos\":true}"}"#
        )

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: false,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertTrue(isOn)
    }

    func testColdStartClearsUnsignedLegacyCacheWhenVerifyEnabled() async throws {
        let identity = "user-1"
        let storage = MemoryStorage()
        let cacheKey = TogglyStorageKeys.featureFlagsCache + hashIdentity(identity)
        await storage.set(
            cacheKey,
            value: #"{"identity":"user-1","flags":"{\"PresalePhotos\":true}"}"#
        )

        let service = TogglyService(
            config: TogglyConfig(
                appKey: "app",
                baseURI: "https://127.0.0.1:9",
                identity: identity,
                featureDefaults: ["PresalePhotos": false],
                refreshInterval: 0,
                verifySignatures: true,
                connectTimeout: 1,
                requestTimeout: 1,
                storage: storage,
                enableLiveUpdates: false
            )
        )

        _ = await service.initialize()
        let isOn = await service.isFeatureOn("PresalePhotos")
        XCTAssertFalse(isOn)
        let remaining = await storage.get(cacheKey)
        XCTAssertNil(remaining)
    }

    // MARK: - Helpers

    private struct SignedFixture {
        let defs: String
        let timestamp: Int64
        let signatureBase64: String
        let jwk: Jwk
    }

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

    private func hashIdentity(_ identity: String) -> String {
        var hash = 0
        for char in identity.unicodeScalars {
            hash = 31 &* hash &+ Int(char.value)
        }
        return String(format: "%08x", abs(hash))
    }
}
