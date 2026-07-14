import CryptoKit
import Foundation
import Security

/// Errors raised while verifying signed feature definitions.
public enum SignedDefsVerifyError: LocalizedError, Equatable {
    case invalidEnvelope
    case missingDefs
    case kidNotAllowed(String)
    case noMatchingJwk(String)
    case unsupportedAlg(String)
    case unsupportedCurve(String)
    case missingCoordinates
    case invalidKid(expected: String, got: String)
    case invalidSignature
    case invalidKey
    case invalidBase64

    public var errorDescription: String? {
        switch self {
        case .invalidEnvelope:
            return "Invalid signed definitions envelope"
        case .missingDefs:
            return "Signed envelope missing defs"
        case .kidNotAllowed(let kid):
            return "kid not allowed: \(kid)"
        case .noMatchingJwk(let kid):
            return "no matching jwk for kid \"\(kid)\""
        case .unsupportedAlg(let alg):
            return "unsupported alg: \(alg)"
        case .unsupportedCurve(let crv):
            return "unsupported crv: \(crv)"
        case .missingCoordinates:
            return "missing x or y coordinate"
        case .invalidKid(let expected, let got):
            return "invalid kid: expected \(expected), got \(got)"
        case .invalidSignature:
            return "invalid signature"
        case .invalidKey:
            return "invalid verification key"
        case .invalidBase64:
            return "invalid base64"
        }
    }
}

/// Signed definitions response envelope.
public struct SignedEnvelope: Codable, Sendable {
    public let defs: FeatureFlags?
    public let data: FeatureFlags?
    public let signature: String
    public let timestamp: Int64
    public let kid: String

    public init(
        defs: FeatureFlags? = nil,
        data: FeatureFlags? = nil,
        signature: String,
        timestamp: Int64,
        kid: String
    ) {
        self.defs = defs
        self.data = data
        self.signature = signature
        self.timestamp = timestamp
        self.kid = kid
    }
}

/// JSON Web Key used for signed definitions verification.
public struct Jwk: Codable, Sendable {
    public let kty: String?
    public let use: String?
    public let kid: String
    public let crv: String?
    public let x: String?
    public let y: String?
    public let alg: String?

    public init(
        kty: String? = "EC",
        use: String? = "sig",
        kid: String,
        crv: String? = "P-256",
        x: String?,
        y: String?,
        alg: String? = "ES256"
    ) {
        self.kty = kty
        self.use = use
        self.kid = kid
        self.crv = crv
        self.x = x
        self.y = y
        self.alg = alg
    }
}

/// JWKS document from `/.well-known/jwks`.
public struct JwkSet: Codable, Sendable {
    public let keys: [Jwk]

    public init(keys: [Jwk]) {
        self.keys = keys
    }
}

/// Production-compatible signed definitions verification (ES256 / P-256).
///
/// Matches Go / Node / Flutter / Android:
/// - payload = exact raw defs JSON + "|" + timestamp
/// - digest  = SHA-256(SHA-256(utf8(payload)))
/// - signature = standard or URL-safe base64 of IEEE P1363 (r||s), with DER fallback
enum SignedDefsVerify {
    /// Extract the exact raw JSON text of a **top-level** property only.
    /// Nested keys (e.g. `data.defs`) are ignored so unsigned outer fields cannot
    /// be swapped in after verifying nested signed bytes.
    static func extractRawJsonProperty(from text: String, key: String) -> String? {
        var index = text.startIndex
        var depth = 0
        var inString = false
        var escape = false

        while index < text.endIndex {
            let character = text[index]
            if inString {
                if escape {
                    escape = false
                } else if character == "\\" {
                    escape = true
                } else if character == "\"" {
                    inString = false
                }
                index = text.index(after: index)
                continue
            }

            if character == "\"" {
                if depth == 1 {
                    guard let keyEnd = findStringEnd(in: text, startingAt: index) else {
                        return nil
                    }
                    let nameStart = text.index(after: index)
                    let propertyName = String(text[nameStart..<keyEnd])
                    var valueStart = text.index(after: keyEnd)
                    while valueStart < text.endIndex, text[valueStart].isWhitespace {
                        valueStart = text.index(after: valueStart)
                    }
                    if propertyName == key, valueStart < text.endIndex, text[valueStart] == ":" {
                        valueStart = text.index(after: valueStart)
                        while valueStart < text.endIndex, text[valueStart].isWhitespace {
                            valueStart = text.index(after: valueStart)
                        }
                        return extractJsonValue(from: text, startingAt: valueStart)
                    }
                    index = text.index(after: keyEnd)
                    continue
                }
                inString = true
                index = text.index(after: index)
                continue
            }

            if character == "{" || character == "[" {
                depth += 1
            } else if character == "}" || character == "]" {
                depth -= 1
            }
            index = text.index(after: index)
        }

        return nil
    }

    /// Parse verified defs JSON bytes into feature flags (do not use envelope fields).
    static func parseDefinitions(_ defsRaw: String) throws -> FeatureFlags {
        guard let data = defsRaw.data(using: .utf8) else {
            throw SignedDefsVerifyError.invalidEnvelope
        }
        do {
            return try JSONDecoder().decode(FeatureFlags.self, from: data)
        } catch {
            throw SignedDefsVerifyError.invalidEnvelope
        }
    }

    /// Parse a signed envelope and return the exact raw defs (or data) JSON substring.
    static func parseSignedEnvelope(_ bodyText: String) throws -> (envelope: SignedEnvelope, defsRaw: String) {
        guard let data = bodyText.data(using: .utf8) else {
            throw SignedDefsVerifyError.invalidEnvelope
        }

        let envelope: SignedEnvelope
        do {
            envelope = try JSONDecoder().decode(SignedEnvelope.self, from: data)
        } catch {
            throw SignedDefsVerifyError.invalidEnvelope
        }

        guard !envelope.signature.isEmpty, !envelope.kid.isEmpty else {
            throw SignedDefsVerifyError.invalidEnvelope
        }

        guard
            let defsRaw = extractRawJsonProperty(from: bodyText, key: "defs")
                ?? extractRawJsonProperty(from: bodyText, key: "data")
        else {
            throw SignedDefsVerifyError.missingDefs
        }

        return (envelope, defsRaw)
    }

    /// Compute kid = SHA1(x_bytes || y_bytes).hexUpper + "ES256".
    static func computeKid(x: String, y: String) throws -> String {
        let xBytes = try base64ToData(x)
        let yBytes = try base64ToData(y)
        var combined = Data()
        combined.append(xBytes)
        combined.append(yBytes)
        let digest = Insecure.SHA1.hash(data: combined)
        let hex = digest.map { String(format: "%02X", $0) }.joined()
        return "\(hex)ES256"
    }

    /// Verify a signed definitions envelope using exact raw defs bytes.
    static func verifySignedDefinitions(
        defsRaw: String,
        signature: String,
        timestamp: Int64,
        kid: String,
        jwks: JwkSet,
        allowedKids: [String]? = nil
    ) throws {
        if let allowedKids, !allowedKids.isEmpty, !allowedKids.contains(kid) {
            throw SignedDefsVerifyError.kidNotAllowed(kid)
        }

        guard let matching = jwks.keys.first(where: { $0.kid == kid }) else {
            throw SignedDefsVerifyError.noMatchingJwk(kid)
        }

        if let alg = matching.alg, alg != "ES256" {
            throw SignedDefsVerifyError.unsupportedAlg(alg)
        }
        if let crv = matching.crv, crv != "P-256" {
            throw SignedDefsVerifyError.unsupportedCurve(crv)
        }
        guard let x = matching.x, let y = matching.y else {
            throw SignedDefsVerifyError.missingCoordinates
        }

        let expectedKid = try computeKid(x: x, y: y)
        if matching.kid != expectedKid {
            throw SignedDefsVerifyError.invalidKid(expected: expectedKid, got: matching.kid)
        }

        let payload = "\(defsRaw)|\(timestamp)"
        guard let payloadData = payload.data(using: .utf8) else {
            throw SignedDefsVerifyError.invalidEnvelope
        }

        let firstDigest = Data(SHA256.hash(data: payloadData))
        let doubleDigest = Data(SHA256.hash(data: firstDigest))
        let signatureData = try base64ToData(signature)
        let publicKey = try createPublicKey(x: x, y: y)

        let derSignature: Data
        if signatureData.count == 64 {
            guard let converted = p1363ToDER(signatureData) else {
                throw SignedDefsVerifyError.invalidSignature
            }
            derSignature = converted
        } else {
            derSignature = signatureData
        }

        var error: Unmanaged<CFError>?
        let ok = SecKeyVerifySignature(
            publicKey,
            .ecdsaSignatureDigestX962SHA256,
            doubleDigest as CFData,
            derSignature as CFData,
            &error
        )

        if !ok {
            throw SignedDefsVerifyError.invalidSignature
        }
    }

    // MARK: - Helpers

    private static func findStringEnd(in text: String, startingAt startQuote: String.Index) -> String.Index? {
        var escape = false
        var index = text.index(after: startQuote)
        while index < text.endIndex {
            let character = text[index]
            if escape {
                escape = false
            } else if character == "\\" {
                escape = true
            } else if character == "\"" {
                return index
            }
            index = text.index(after: index)
        }
        return nil
    }

    private static func extractJsonValue(from text: String, startingAt start: String.Index) -> String? {
        guard start < text.endIndex else {
            return nil
        }

        let first = text[start]
        if first == "{" || first == "[" {
            var depth = 0
            var inString = false
            var escape = false
            var index = start
            while index < text.endIndex {
                let character = text[index]
                if inString {
                    if escape {
                        escape = false
                    } else if character == "\\" {
                        escape = true
                    } else if character == "\"" {
                        inString = false
                    }
                } else if character == "\"" {
                    inString = true
                } else if character == "{" || character == "[" {
                    depth += 1
                } else if character == "}" || character == "]" {
                    depth -= 1
                    if depth == 0 {
                        return String(text[start...index])
                    }
                }
                index = text.index(after: index)
            }
            return nil
        }

        if first == "\"" {
            guard let end = findStringEnd(in: text, startingAt: start) else {
                return nil
            }
            return String(text[start...end])
        }

        var end = start
        while end < text.endIndex {
            let character = text[end]
            if character.isWhitespace || character == "," || character == "}" || character == "]" {
                break
            }
            end = text.index(after: end)
        }
        let value = String(text[start..<end])
        return value.isEmpty ? nil : value
    }

    static func base64ToData(_ value: String) throws -> Data {
        let normalized = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        let padded: String
        if remainder == 0 {
            padded = normalized
        } else {
            padded = normalized + String(repeating: "=", count: 4 - remainder)
        }
        guard let data = Data(base64Encoded: padded) else {
            throw SignedDefsVerifyError.invalidBase64
        }
        return data
    }

    static func base64URLEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private static func createPublicKey(x: String, y: String) throws -> SecKey {
        var xBytes = try base64ToData(x)
        var yBytes = try base64ToData(y)
        xBytes = padLeft(xBytes, to: 32)
        yBytes = padLeft(yBytes, to: 32)

        var x963 = Data([0x04])
        x963.append(xBytes)
        x963.append(yBytes)

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
            kSecAttrKeySizeInBits as String: 256
        ]

        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(x963 as CFData, attributes as CFDictionary, &error) else {
            throw SignedDefsVerifyError.invalidKey
        }
        return key
    }

    private static func padLeft(_ data: Data, to length: Int) -> Data {
        if data.count >= length {
            return data.suffix(length)
        }
        return Data(repeating: 0, count: length - data.count) + data
    }

    /// Convert IEEE P1363 (r||s) to X9.62 / DER ECDSA signature.
    static func p1363ToDER(_ signature: Data) -> Data? {
        guard signature.count == 64 else { return nil }
        let r = encodeASN1Integer(signature.prefix(32))
        let s = encodeASN1Integer(signature.suffix(32))

        var sequence = Data()
        sequence.append(0x30)
        let contentLength = r.count + s.count
        sequence.append(contentsOf: encodeLength(contentLength))
        sequence.append(r)
        sequence.append(s)
        return sequence
    }

    /// Convert DER ECDSA signature to IEEE P1363 (r||s).
    static func derToP1363(_ der: Data) -> Data? {
        var index = der.startIndex
        guard index < der.endIndex, der[index] == 0x30 else { return nil }
        index = der.index(after: index)

        guard let (_, afterLength) = readLength(der, at: index) else { return nil }
        index = afterLength

        guard let (r, afterR) = readASN1Integer(der, at: index) else { return nil }
        index = afterR
        guard let (s, _) = readASN1Integer(der, at: index) else { return nil }

        var result = Data()
        result.append(padLeft(r, to: 32))
        result.append(padLeft(s, to: 32))
        return result
    }

    private static func encodeASN1Integer(_ bytes: Data.SubSequence) -> Data {
        var value = Data(bytes)
        while value.count > 1, value[0] == 0x00, value[1] & 0x80 == 0 {
            value.removeFirst()
        }
        if value.isEmpty {
            value = Data([0x00])
        }
        if value[0] & 0x80 != 0 {
            value.insert(0x00, at: 0)
        }

        var encoded = Data([0x02])
        encoded.append(contentsOf: encodeLength(value.count))
        encoded.append(value)
        return encoded
    }

    private static func encodeLength(_ length: Int) -> [UInt8] {
        if length < 0x80 {
            return [UInt8(length)]
        }
        if length < 0x100 {
            return [0x81, UInt8(length)]
        }
        return [0x82, UInt8((length >> 8) & 0xff), UInt8(length & 0xff)]
    }

    private static func readLength(_ data: Data, at index: Data.Index) -> (Int, Data.Index)? {
        guard index < data.endIndex else { return nil }
        let first = data[index]
        var next = data.index(after: index)
        if first & 0x80 == 0 {
            return (Int(first), next)
        }
        let count = Int(first & 0x7f)
        guard count > 0, data.distance(from: next, to: data.endIndex) >= count else { return nil }
        var length = 0
        for _ in 0..<count {
            length = (length << 8) | Int(data[next])
            next = data.index(after: next)
        }
        return (length, next)
    }

    private static func readASN1Integer(_ data: Data, at index: Data.Index) -> (Data, Data.Index)? {
        guard index < data.endIndex, data[index] == 0x02 else { return nil }
        let afterTag = data.index(after: index)
        guard let (length, afterLength) = readLength(data, at: afterTag) else { return nil }
        guard data.distance(from: afterLength, to: data.endIndex) >= length else { return nil }
        let end = data.index(afterLength, offsetBy: length)
        var value = data.subdata(in: afterLength..<end)
        while value.count > 1, value[0] == 0x00 {
            value.removeFirst()
        }
        return (value, end)
    }
}
