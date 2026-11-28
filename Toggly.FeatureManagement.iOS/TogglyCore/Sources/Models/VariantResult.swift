import Foundation

/// Server-evaluated feature variant assignment.
///
/// Returned by `TogglyService.getVariant(_:)` when `TogglyConfig.enableVariants`
/// is `true` and the current identity has a variant assigned for that feature.
public struct VariantResult: @unchecked Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    /// The assigned variant name.
    public let name: String

    /// Untyped server-provided configuration payload for the variant
    /// (JSON primitive, dictionary, or array), or `nil`.
    public let configurationValue: Any?

    /// Declared value type (`"boolean" | "string" | "number" | "json" | "datetime"`)
    /// for `configurationValue`, when the catalog or evaluated envelope provided
    /// one (OPS-2099 / OPS-2102). `nil` for legacy/untyped catalogs.
    public let valueType: String?

    public init(name: String, configurationValue: Any? = nil, valueType: String? = nil) {
        self.name = name
        self.configurationValue = configurationValue
        self.valueType = valueType
    }

    public var description: String { "VariantResult(name: \(name))" }
    public var debugDescription: String { description }
}

/// Wire entry for a single feature key from `evaluated-variants-signed`:
/// `{ enabled, variant?, configurationValue?, valueType? }`. Already fully
/// evaluated server-side; no client-side entity-gate evaluation is required.
struct EvaluatedVariantDef: @unchecked Sendable {
    let enabled: Bool
    let variant: String?
    let configurationValue: Any?
    let valueType: String?
}

typealias EvaluatedVariantDefs = [String: EvaluatedVariantDef]

/// Parses an `evaluated-variants-signed` defs payload into per-key variant entries.
/// Throws when the top-level payload is not a JSON object, matching
/// `parseEvaluatedDefinitions`. Malformed per-key entries default to disabled
/// with no variant, matching JS/Flutter semantics.
func parseEvaluatedVariantDefs(from data: Data) throws -> EvaluatedVariantDefs {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw SignedDefsVerifyError.invalidEnvelope
    }
    var result: EvaluatedVariantDefs = [:]
    for (key, value) in object {
        guard let entry = value as? [String: Any] else {
            result[key] = EvaluatedVariantDef(enabled: false, variant: nil, configurationValue: nil, valueType: nil)
            continue
        }
        let enabled = (entry["enabled"] as? Bool) ?? false
        let variant = (entry["variant"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let valueType = (entry["valueType"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        result[key] = EvaluatedVariantDef(
            enabled: enabled,
            variant: variant,
            configurationValue: entry["configurationValue"],
            valueType: valueType
        )
    }
    return result
}

func parseEvaluatedVariantDefs(from defsRaw: String) throws -> EvaluatedVariantDefs {
    guard let data = defsRaw.data(using: .utf8) else {
        throw SignedDefsVerifyError.invalidEnvelope
    }
    return try parseEvaluatedVariantDefs(from: data)
}

/// Derives the boolean flag map used for `isFeatureOn` / `evaluateFeatureGate`
/// from server-evaluated variant entries.
func toBooleanFlags(fromVariantDefs defs: EvaluatedVariantDefs) -> FeatureFlags {
    defs.mapValues { $0.enabled }
}
