import CryptoKit
import Foundation
import XCTest
@testable import TogglyCore

final class SignedDefsVerifyTests: XCTestCase {
    func testExtractsExactDefsBytes() {
        let body = "{\"defs\":{\"a\":1},\"signature\":\"x\",\"timestamp\":1,\"kid\":\"k\"}"
        XCTAssertEqual(SignedDefsVerify.extractRawJsonProperty(from: body, key: "defs"), "{\"a\":1}")
    }

    func testAcceptsDoubleSha256SignaturesOverRawDefs() throws {
        let fixture = try makeSignedFixture(
            defs: "{\"PresalePhotos\":true,\"PuppySales\":false}",
            timestamp: 1783915396,
            hashMode: .double
        )

        XCTAssertNoThrow(
            try SignedDefsVerify.verifySignedDefinitions(
                defsRaw: fixture.defs,
                signature: fixture.signatureBase64,
                timestamp: fixture.timestamp,
                kid: fixture.jwk.kid,
                jwks: JwkSet(keys: [fixture.jwk])
            )
        )
    }

    func testRejectsSingleSha256Signatures() throws {
        let fixture = try makeSignedFixture(
            defs: "{\"PresalePhotos\":true}",
            timestamp: 1783915396,
            hashMode: .single
        )

        XCTAssertThrowsError(
            try SignedDefsVerify.verifySignedDefinitions(
                defsRaw: fixture.defs,
                signature: fixture.signatureBase64,
                timestamp: fixture.timestamp,
                kid: fixture.jwk.kid,
                jwks: JwkSet(keys: [fixture.jwk])
            )
        ) { error in
            XCTAssertEqual(error as? SignedDefsVerifyError, .invalidSignature)
        }
    }

    func testRejectsReserializedDefs() throws {
        let defs = "{\"b\":2,\"a\":1}"
        let fixture = try makeSignedFixture(
            defs: defs,
            timestamp: 100,
            hashMode: .double
        )

        try SignedDefsVerify.verifySignedDefinitions(
            defsRaw: defs,
            signature: fixture.signatureBase64,
            timestamp: fixture.timestamp,
            kid: fixture.jwk.kid,
            jwks: JwkSet(keys: [fixture.jwk])
        )

        let pretty = "{\n  \"b\": 2,\n  \"a\": 1\n}"
        XCTAssertThrowsError(
            try SignedDefsVerify.verifySignedDefinitions(
                defsRaw: pretty,
                signature: fixture.signatureBase64,
                timestamp: fixture.timestamp,
                kid: fixture.jwk.kid,
                jwks: JwkSet(keys: [fixture.jwk])
            )
        ) { error in
            XCTAssertEqual(error as? SignedDefsVerifyError, .invalidSignature)
        }
    }

    func testParseSignedEnvelopeKeepsRawDefs() throws {
        let defs = "{\"feature-a\":true}"
        let fixture = try makeSignedFixture(
            defs: defs,
            timestamp: 42,
            hashMode: .double
        )
        let body =
            "{\"defs\":\(defs),\"signature\":\"\(fixture.signatureBase64)\",\"timestamp\":\(fixture.timestamp),\"kid\":\"\(fixture.jwk.kid)\"}"

        let parsed = try SignedDefsVerify.parseSignedEnvelope(body)
        XCTAssertEqual(parsed.defsRaw, defs)

        try SignedDefsVerify.verifySignedDefinitions(
            defsRaw: parsed.defsRaw,
            signature: parsed.envelope.signature,
            timestamp: parsed.envelope.timestamp,
            kid: parsed.envelope.kid,
            jwks: JwkSet(keys: [fixture.jwk])
        )
    }

    func testRejectsEmptySignatureOrKid() {
        XCTAssertThrowsError(
            try SignedDefsVerify.parseSignedEnvelope(
                "{\"defs\":{\"a\":1},\"signature\":\"\",\"timestamp\":1,\"kid\":\"k\"}"
            )
        ) { error in
            XCTAssertEqual(error as? SignedDefsVerifyError, .invalidEnvelope)
        }
        XCTAssertThrowsError(
            try SignedDefsVerify.parseSignedEnvelope(
                "{\"defs\":{\"a\":1},\"signature\":\"x\",\"timestamp\":1,\"kid\":\"\"}"
            )
        ) { error in
            XCTAssertEqual(error as? SignedDefsVerifyError, .invalidEnvelope)
        }
    }

    func testExtractRawJsonPropertyIgnoresNestedDefsUnderData() {
        let body =
            "{\"data\":{\"defs\":{\"Innocent\":true}},\"signature\":\"x\",\"timestamp\":1,\"kid\":\"k\"}"
        XCTAssertNil(SignedDefsVerify.extractRawJsonProperty(from: body, key: "defs"))
        XCTAssertEqual(
            SignedDefsVerify.extractRawJsonProperty(from: body, key: "data"),
            "{\"defs\":{\"Innocent\":true}}"
        )
    }

    func testNestedDefsAttackUsesTopLevelDefsAndRejectsSignature() throws {
        let innocent = "{\"Innocent\":true}"
        let evil = "{\"Evil\":true}"
        let fixture = try makeSignedFixture(
            defs: innocent,
            timestamp: 99,
            hashMode: .double
        )
        // Nested "defs" appears first (would fool regex-first match); top-level evil is unsigned.
        // Use unknown "nested" key so Codable still parses signature/timestamp/kid.
        let body =
            "{\"nested\":{\"defs\":\(innocent)},\"defs\":\(evil),\"signature\":\"\(fixture.signatureBase64)\",\"timestamp\":\(fixture.timestamp),\"kid\":\"\(fixture.jwk.kid)\"}"

        XCTAssertEqual(SignedDefsVerify.extractRawJsonProperty(from: body, key: "defs"), evil)

        let parsed = try SignedDefsVerify.parseSignedEnvelope(body)
        XCTAssertEqual(parsed.defsRaw, evil)

        XCTAssertThrowsError(
            try SignedDefsVerify.verifySignedDefinitions(
                defsRaw: parsed.defsRaw,
                signature: parsed.envelope.signature,
                timestamp: parsed.envelope.timestamp,
                kid: parsed.envelope.kid,
                jwks: JwkSet(keys: [fixture.jwk])
            )
        ) { error in
            XCTAssertEqual(error as? SignedDefsVerifyError, .invalidSignature)
        }

        // Same attack shape with data.defs: extract still picks top-level evil;
        // envelope decode fails closed because data is not FeatureFlags.
        let dataBody =
            "{\"data\":{\"defs\":\(innocent)},\"defs\":\(evil),\"signature\":\"\(fixture.signatureBase64)\",\"timestamp\":\(fixture.timestamp),\"kid\":\"\(fixture.jwk.kid)\"}"
        XCTAssertEqual(SignedDefsVerify.extractRawJsonProperty(from: dataBody, key: "defs"), evil)
        XCTAssertThrowsError(try SignedDefsVerify.parseSignedEnvelope(dataBody)) { error in
            XCTAssertEqual(error as? SignedDefsVerifyError, .invalidEnvelope)
        }
    }

    func testAppliedFlagsComeFromVerifiedDefsRaw() throws {
        let defs = "{\"PresalePhotos\":true,\"PuppySales\":false}"
        let fixture = try makeSignedFixture(
            defs: defs,
            timestamp: 1783915396,
            hashMode: .double
        )
        let body =
            "{\"defs\":\(defs),\"signature\":\"\(fixture.signatureBase64)\",\"timestamp\":\(fixture.timestamp),\"kid\":\"\(fixture.jwk.kid)\"}"

        let parsed = try SignedDefsVerify.parseSignedEnvelope(body)
        try SignedDefsVerify.verifySignedDefinitions(
            defsRaw: parsed.defsRaw,
            signature: parsed.envelope.signature,
            timestamp: parsed.envelope.timestamp,
            kid: parsed.envelope.kid,
            jwks: JwkSet(keys: [fixture.jwk])
        )

        let applied = try SignedDefsVerify.parseDefinitions(parsed.defsRaw)
        let expected = try JSONDecoder().decode(
            FeatureFlags.self,
            from: Data(defs.utf8)
        )
        XCTAssertEqual(applied, expected)
        XCTAssertEqual(applied, ["PresalePhotos": true, "PuppySales": false])
    }

    // MARK: - Fixtures

    private enum HashMode {
        case single
        case double
    }

    private struct SignedFixture {
        let defs: String
        let timestamp: Int64
        let signatureBase64: String
        let jwk: Jwk
    }

    private func makeSignedFixture(
        defs: String,
        timestamp: Int64,
        hashMode: HashMode
    ) throws -> SignedFixture {
        let privateKey = P256.Signing.PrivateKey()
        let publicBytes = privateKey.publicKey.x963Representation
        // Uncompressed point: 0x04 || x || y
        XCTAssertEqual(publicBytes.count, 65)
        let xBytes = publicBytes.subdata(in: 1..<33)
        let yBytes = publicBytes.subdata(in: 33..<65)
        let x = SignedDefsVerify.base64URLEncode(xBytes)
        let y = SignedDefsVerify.base64URLEncode(yBytes)
        let kid = try SignedDefsVerify.computeKid(x: x, y: y)

        let payload = "\(defs)|\(timestamp)"
        guard let payloadData = payload.data(using: .utf8) else {
            throw SignedDefsVerifyError.invalidEnvelope
        }

        let digest: SHA256Digest
        switch hashMode {
        case .single:
            digest = SHA256.hash(data: payloadData)
        case .double:
            let first = SHA256.hash(data: payloadData)
            digest = SHA256.hash(data: Data(first))
        }

        // CryptoKit signs a Digest without hashing again — matches Security digest verify.
        let signature = try privateKey.signature(for: digest)

        return SignedFixture(
            defs: defs,
            timestamp: timestamp,
            signatureBase64: signature.rawRepresentation.base64EncodedString(),
            jwk: Jwk(kid: kid, x: x, y: y)
        )
    }
}
