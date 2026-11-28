import Foundation

/// Soft-decodes resolved feature values by declared `valueType` (OPS-2102/OPS-2107).
///
/// Mirrors `toggly-eval`'s `feature-value-codec.ts` semantics: never throws for
/// shape alone, never returns a wrong-typed value. A missing `valueType`
/// (legacy catalogs) allows the decode attempt; a declared type that
/// disagrees with the requested getter soft-nulls.
enum FeatureValueDecoder {
    /// Prefer explicit catalog/evaluated `valueType`; soft-null when the getter
    /// requests a type that disagrees with the declared one.
    static func valueTypeMatches(_ declaredType: String?, requestedType: String) -> Bool {
        guard let declaredType, !declaredType.isEmpty else { return true }
        return declaredType == requestedType
    }

    /// Soft-decodes `raw` as a `String`. Nil/mismatch/non-string → `nil`.
    static func decodeStringValue(_ raw: Any?, declaredType: String?) -> String? {
        guard valueTypeMatches(declaredType, requestedType: "string") else { return nil }
        return raw as? String
    }

    /// Soft-decodes `raw` as a `Double`. Accepts numeric strings; nil/mismatch → `nil`.
    static func decodeNumberValue(_ raw: Any?, declaredType: String?) -> Double? {
        guard valueTypeMatches(declaredType, requestedType: "number") else { return nil }
        if let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            let value = number.doubleValue
            return value.isFinite ? value : nil
        }
        if let text = raw as? String, !text.trimmingCharacters(in: .whitespaces).isEmpty {
            return Double(text)
        }
        return nil
    }

    /// Soft-decodes `raw` as `T`. Nil/mismatch → `nil`; delegates structural
    /// decoding to `VariantValueDecoder`.
    static func decodeJsonValue<T: Decodable>(_ raw: Any?, declaredType: String?, as type: T.Type = T.self) -> T? {
        guard valueTypeMatches(declaredType, requestedType: "json") else { return nil }
        return VariantValueDecoder.decode(raw, as: type)
    }

    /// Soft-decodes `raw` as a JSON-ish `Any` (dictionary, array, or scalar).
    /// Nil/mismatch → `nil`.
    static func decodeJsonValue(_ raw: Any?, declaredType: String?) -> Any? {
        guard valueTypeMatches(declaredType, requestedType: "json") else { return nil }
        return raw
    }

    /// Soft-decodes `raw` as a `Date` from an ISO-8601 wire string, an existing
    /// `Date`, or epoch milliseconds. Nil/mismatch/unparseable → `nil`.
    static func decodeDateTimeValue(_ raw: Any?, declaredType: String?) -> Date? {
        guard valueTypeMatches(declaredType, requestedType: "datetime") else { return nil }
        if let date = raw as? Date {
            return date
        }
        if let number = raw as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
            return Date(timeIntervalSince1970: number.doubleValue / 1000)
        }
        guard let text = raw as? String, !text.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) {
            return date
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        return iso.date(from: text)
    }
}
