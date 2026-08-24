import Foundation

/// A single entity-gate comparison rule.
public struct EntityGateRule: Equatable, Sendable {
    public let property: String
    public let op: String
    public let value: String
    public let type: String?

    public init(property: String, op: String, value: String, type: String? = nil) {
        self.property = property
        self.op = op
        self.value = value
        self.type = type
    }
}

/// Client-side entity gate (all/any over rules).
public struct EntityGate: Equatable, Sendable {
    public let requirement: String
    public let rules: [EntityGateRule]

    public init(requirement: String = "all", rules: [EntityGateRule]) {
        self.requirement = requirement
        self.rules = rules
    }
}

/// Mixed evaluated definition: a boolean or an entity gate.
public enum EvaluatedDefinition: Equatable, Sendable {
    case boolean(Bool)
    case gate(EntityGate)
}

public typealias EvaluatedDefinitions = [String: EvaluatedDefinition]

/// Per-evaluation entity context. Distinct from user identity (`setIdentity`).
public struct TogglyEntityContext: @unchecked Sendable {
    public let kind: String
    public let key: String
    public let attributes: [String: Any]

    public init(kind: String, key: String, attributes: [String: Any]) {
        self.kind = kind
        self.key = key
        self.attributes = attributes
    }
}

public typealias EntityContextMapper = @Sendable (Any) -> TogglyEntityContext

private let equalityOps: Set<String> = ["eq", "neq"]
private let comparisonOps: Set<String> = ["gt", "gte", "lt", "lte"]
private let inOps: Set<String> = ["in"]
private let containsOps: Set<String> = ["contains"]

private let mapperLock = NSLock()
private var contextMappers: [String: EntityContextMapper] = [:]

public func isEntityGate(_ value: Any?) -> Bool {
    guard let gate = value as? EntityGate else {
        return false
    }
    if gate.requirement != "all" && gate.requirement != "any" {
        return false
    }
    return true
}

public func resolveEvaluatedDefinition(
    _ value: EvaluatedDefinition?,
    context: TogglyEntityContext? = nil,
    defaultValue: Bool = false
) -> Bool {
    guard let value else {
        return defaultValue
    }
    switch value {
    case .boolean(let flag):
        return flag
    case .gate(let gate):
        guard let context else {
            return false
        }
        return applyEntityGate(gate, attributes: context.attributes)
    }
}

public func toBooleanDefinitions(
    _ definitions: EvaluatedDefinitions,
    context: TogglyEntityContext? = nil
) -> FeatureFlags {
    var result: FeatureFlags = [:]
    for (key, value) in definitions {
        result[key] = resolveEvaluatedDefinition(value, context: context)
    }
    return result
}

public func applyEntityGate(_ gate: EntityGate, attributes: [String: Any]) -> Bool {
    if gate.rules.isEmpty {
        return false
    }
    let requirement = gate.requirement == "any" ? "any" : "all"
    let results = gate.rules.map { evaluateRule($0, attributes: attributes) }
    return requirement == "all" ? results.allSatisfy { $0 } : results.contains { $0 }
}

public func registerContext(_ kind: String, mapper: @escaping EntityContextMapper) {
    mapperLock.lock()
    contextMappers[kind] = mapper
    mapperLock.unlock()
}

public func resolveEntityContext(kind: String, entity: Any) -> TogglyEntityContext? {
    mapperLock.lock()
    let mapper = contextMappers[kind]
    mapperLock.unlock()
    return mapper?(entity)
}

public func mapEntityContext(
    kind: String,
    entity: Any,
    mapper: EntityContextMapper? = nil
) -> TogglyEntityContext? {
    if let mapper {
        return mapper(entity)
    }
    return resolveEntityContext(kind: kind, entity: entity)
}

public func clearRegisteredContexts() {
    mapperLock.lock()
    contextMappers.removeAll()
    mapperLock.unlock()
}

public func normalizeEntityContext(_ context: Any?, kind: String? = nil) -> TogglyEntityContext? {
    guard let context else {
        return nil
    }
    if let entity = context as? TogglyEntityContext {
        return entity
    }
    if let kind {
        return mapEntityContext(kind: kind, entity: context)
    }
    return nil
}

public func fromBooleanDefaults(_ defaults: FeatureFlags) -> EvaluatedDefinitions {
    defaults.mapValues { .boolean($0) }
}

public func parseEvaluatedDefinitions(from defsRaw: String) throws -> EvaluatedDefinitions {
    guard let data = defsRaw.data(using: .utf8) else {
        throw SignedDefsVerifyError.invalidEnvelope
    }
    return try parseEvaluatedDefinitions(from: data)
}

public func parseEvaluatedDefinitions(from data: Data) throws -> EvaluatedDefinitions {
    let object = try JSONSerialization.jsonObject(with: data)
    guard let dict = object as? [String: Any] else {
        throw SignedDefsVerifyError.invalidEnvelope
    }
    var result: EvaluatedDefinitions = [:]
    for (key, value) in dict {
        result[key] = parseDefinitionValue(value)
    }
    return result
}

func parseDefinitionValue(_ value: Any) -> EvaluatedDefinition {
    if let flag = value as? Bool {
        return .boolean(flag)
    }
    if let obj = value as? [String: Any], let gate = parseEntityGate(obj) {
        return .gate(gate)
    }
    return .boolean(false)
}

func parseEntityGate(_ obj: [String: Any]) -> EntityGate? {
    guard let rulesRaw = obj["rules"] as? [Any] else {
        return nil
    }
    if let requirement = obj["requirement"] as? String,
       requirement != "all", requirement != "any" {
        return nil
    }
    let rules: [EntityGateRule] = rulesRaw.compactMap { item in
        guard let rule = item as? [String: Any],
              let property = rule["property"] as? String,
              let op = rule["op"] as? String else {
            return nil
        }
        let value = stringifyJSON(rule["value"])
        let type = rule["type"] as? String
        return EntityGateRule(property: property, op: op, value: value, type: type)
    }
    let requirement = (obj["requirement"] as? String) ?? "all"
    return EntityGate(requirement: requirement, rules: rules)
}

private func stringifyJSON(_ value: Any?) -> String {
    guard let value, !(value is NSNull) else {
        return ""
    }
    if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
        return number.stringValue
    }
    return String(describing: value)
}

private func evaluateRule(_ rule: EntityGateRule, attributes: [String: Any]) -> Bool {
    guard let actualKey = findAttributeKey(attributes, property: rule.property) else {
        return false
    }
    let actual = attributes[actualKey]
    let op = rule.op.lowercased()
    let valueType = rule.type ?? "string"

    if equalityOps.contains(op) {
        return compareEquality(actual, expected: rule.value, shouldEqual: op == "eq")
    }
    if comparisonOps.contains(op) {
        return compareOrdered(actual, expected: rule.value, valueType: valueType, op: op)
    }
    if inOps.contains(op) {
        return compareIn(actual, expected: rule.value)
    }
    if containsOps.contains(op) {
        return compareContains(actual, expected: rule.value, valueType: valueType)
    }
    return false
}

private func findAttributeKey(_ attributes: [String: Any], property: String) -> String? {
    if attributes[property] != nil || attributes.keys.contains(property) {
        return property
    }
    let expected = property.lowercased()
    return attributes.keys.first { $0.lowercased() == expected }
}

private func stringifyActual(_ actual: Any?) -> String {
    guard let actual, !(actual is NSNull) else {
        return ""
    }
    if let number = actual as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
        let value = number.doubleValue
        if value.rounded() == value {
            return String(Int64(value))
        }
        return String(value)
    }
    return String(describing: actual)
}

private func compareEquality(_ actual: Any?, expected: String, shouldEqual: Bool) -> Bool {
    let equal = stringifyActual(actual).caseInsensitiveCompare(expected) == .orderedSame
    return shouldEqual ? equal : !equal
}

private func compareOrdered(_ actual: Any?, expected: String, valueType: String, op: String) -> Bool {
    if valueType == "datetime" {
        guard let actualDate = parseDateTime(actual), let expectedDate = parseDateTime(expected) else {
            return false
        }
        return compareNumbers(actualDate, expectedDate, op: op)
    }
    guard valueType == "number" else {
        return false
    }
    guard let actualNumber = parseNumber(actual), let expectedNumber = parseNumber(expected) else {
        return false
    }
    return compareNumbers(actualNumber, expectedNumber, op: op)
}

private func compareNumbers(_ actual: Double, _ expected: Double, op: String) -> Bool {
    switch op {
    case "gt": return actual > expected
    case "gte": return actual >= expected
    case "lt": return actual < expected
    case "lte": return actual <= expected
    default: return false
    }
}

private func compareIn(_ actual: Any?, expected: String) -> Bool {
    let actualString = stringifyActual(actual)
    return expected
        .split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .contains { $0.caseInsensitiveCompare(actualString) == .orderedSame }
}

private func compareContains(_ actual: Any?, expected: String, valueType: String) -> Bool {
    if valueType == "string[]", let array = actual as? [Any] {
        return array.contains { stringifyActual($0).caseInsensitiveCompare(expected) == .orderedSame }
    }
    return stringifyActual(actual).localizedCaseInsensitiveContains(expected)
}

private func parseDateTime(_ value: Any?) -> Double? {
    if let date = value as? Date {
        return date.timeIntervalSince1970 * 1000
    }
    if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
        return number.doubleValue
    }
    let text = stringifyActual(value)
    if text.isEmpty {
        return nil
    }
    if let millis = Double(text), text.allSatisfy({ $0.isNumber || $0 == "." || $0 == "-" }) {
        // ISO dates are not plain numbers; only treat numeric strings as epoch millis.
        if !text.contains("-") || text.hasPrefix("-") && !text.dropFirst().contains("-") {
            return millis
        }
    }
    let isoWithFraction = ISO8601DateFormatter()
    isoWithFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = isoWithFraction.date(from: text) {
        return date.timeIntervalSince1970 * 1000
    }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime]
    if let date = iso.date(from: text) {
        return date.timeIntervalSince1970 * 1000
    }
    let day = DateFormatter()
    day.locale = Locale(identifier: "en_US_POSIX")
    day.timeZone = TimeZone(secondsFromGMT: 0)
    day.dateFormat = "yyyy-MM-dd"
    if let date = day.date(from: text) {
        return date.timeIntervalSince1970 * 1000
    }
    return nil
}

private func parseNumber(_ value: Any?) -> Double? {
    if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() {
        let parsed = number.doubleValue
        return parsed.isFinite ? parsed : nil
    }
    let text = stringifyActual(value)
    if text.isEmpty {
        return nil
    }
    guard let parsed = Double(text), parsed.isFinite else {
        return nil
    }
    return parsed
}

public func evaluateResolvedKeys(
    featureKeys: [String],
    requirementAll: Bool,
    negate: Bool,
    isEnabled: (String) -> Bool
) -> Bool {
    if featureKeys.isEmpty {
        return !negate
    }
    let result = requirementAll ? featureKeys.allSatisfy(isEnabled) : featureKeys.contains(where: isEnabled)
    return negate ? !result : result
}

public func evaluateStoredFeatureKeys(
    features: EvaluatedDefinitions?,
    featureKeys: [String],
    requirementAll: Bool,
    negate: Bool,
    isEnabled: (String) -> Bool
) -> Bool {
    if !featureKeys.isEmpty && (features == nil || features?.isEmpty == true) {
        return negate
    }
    return evaluateResolvedKeys(
        featureKeys: featureKeys,
        requirementAll: requirementAll,
        negate: negate,
        isEnabled: isEnabled
    )
}

public func evaluateEvaluatedGate(
    features: EvaluatedDefinitions,
    featureKeys: [String],
    requirementAll: Bool = true,
    negate: Bool = false,
    entityContext: TogglyEntityContext? = nil
) -> Bool {
    evaluateStoredFeatureKeys(
        features: features,
        featureKeys: featureKeys,
        requirementAll: requirementAll,
        negate: negate
    ) { key in
        resolveEvaluatedDefinition(features[key], context: entityContext)
    }
}
