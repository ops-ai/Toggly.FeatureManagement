package io.toggly.core

import io.toggly.core.models.FeatureFlags
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

data class EntityGateRule(
    val property: String,
    val op: String,
    val value: String,
    val type: String? = null
)

data class EntityGate(
    val requirement: String = "all",
    val rules: List<EntityGateRule>
)

sealed class EvaluatedDefinition {
    data class BooleanValue(val value: Boolean) : EvaluatedDefinition()
    data class Gate(val gate: EntityGate) : EvaluatedDefinition()
}

typealias EvaluatedDefinitions = Map<String, EvaluatedDefinition>

data class TogglyEntityContext(
    val kind: String,
    val key: String,
    val attributes: Map<String, Any?>
)

fun interface EntityContextMapper {
    fun map(entity: Any): TogglyEntityContext
}

private val equalityOps = setOf("eq", "neq")
private val comparisonOps = setOf("gt", "gte", "lt", "lte")
private val inOps = setOf("in")
private val containsOps = setOf("contains")

private val contextMappers = ConcurrentHashMap<String, EntityContextMapper>()

fun isEntityGate(value: Any?): Boolean {
    val gate = value as? EntityGate ?: return false
    if (gate.requirement != "all" && gate.requirement != "any") {
        return false
    }
    return true
}

fun resolveEvaluatedDefinition(
    value: EvaluatedDefinition?,
    context: TogglyEntityContext? = null,
    defaultValue: Boolean = false
): Boolean {
    if (value == null) {
        return defaultValue
    }
    return when (value) {
        is EvaluatedDefinition.BooleanValue -> value.value
        is EvaluatedDefinition.Gate -> {
            if (context == null) {
                false
            } else {
                applyEntityGate(value.gate, context.attributes)
            }
        }
    }
}

fun toBooleanDefinitions(
    definitions: EvaluatedDefinitions,
    context: TogglyEntityContext? = null
): FeatureFlags {
    return definitions.mapValues { (_, value) ->
        resolveEvaluatedDefinition(value, context)
    }
}

fun applyEntityGate(gate: EntityGate, attributes: Map<String, Any?>): Boolean {
    if (gate.rules.isEmpty()) {
        return false
    }
    val requirement = if (gate.requirement == "any") "any" else "all"
    val results = gate.rules.map { evaluateRule(it, attributes) }
    return if (requirement == "all") results.all { it } else results.any { it }
}

fun registerContext(kind: String, mapper: EntityContextMapper) {
    contextMappers[kind] = mapper
}

fun <T : Any> registerContext(kind: String, mapper: (T) -> TogglyEntityContext) {
    contextMappers[kind] = EntityContextMapper { entity ->
        @Suppress("UNCHECKED_CAST")
        mapper(entity as T)
    }
}

fun resolveEntityContext(kind: String, entity: Any): TogglyEntityContext? {
    return contextMappers[kind]?.map(entity)
}

fun mapEntityContext(
    kind: String,
    entity: Any,
    mapper: EntityContextMapper? = null
): TogglyEntityContext? {
    if (mapper != null) {
        return mapper.map(entity)
    }
    return resolveEntityContext(kind, entity)
}

fun clearRegisteredContexts() {
    contextMappers.clear()
}

fun normalizeEntityContext(context: Any?, kind: String? = null): TogglyEntityContext? {
    if (context == null) {
        return null
    }
    if (context is TogglyEntityContext) {
        return context
    }
    if (kind != null) {
        return mapEntityContext(kind, context)
    }
    return null
}

fun fromBooleanDefaults(defaults: FeatureFlags): EvaluatedDefinitions {
    return defaults.mapValues { EvaluatedDefinition.BooleanValue(it.value) }
}

fun parseEvaluatedDefinitions(element: JsonElement): EvaluatedDefinitions {
    val obj = element as? JsonObject
        ?: throw IllegalArgumentException("Definitions must be a JSON object")
    return obj.mapValues { (_, value) -> parseDefinitionValue(value) }
}

fun parseEvaluatedDefinitions(defsRaw: String): EvaluatedDefinitions {
    return parseEvaluatedDefinitions(
        kotlinx.serialization.json.Json.parseToJsonElement(defsRaw)
    )
}

fun parseDefinitionValue(value: JsonElement): EvaluatedDefinition {
    if (value is JsonPrimitive) {
        val bool = value.booleanOrNull
        return if (bool != null) {
            EvaluatedDefinition.BooleanValue(bool)
        } else {
            EvaluatedDefinition.BooleanValue(false)
        }
    }
    if (value is JsonObject) {
        val gate = parseEntityGate(value) ?: return EvaluatedDefinition.BooleanValue(false)
        return EvaluatedDefinition.Gate(gate)
    }
    return EvaluatedDefinition.BooleanValue(false)
}

fun parseEntityGate(obj: JsonObject): EntityGate? {
    val rulesElement = obj["rules"] as? JsonArray ?: return null
    val requirement = obj["requirement"]?.jsonPrimitive?.contentOrNull
    if (requirement != null && requirement != "all" && requirement != "any") {
        return null
    }
    val rules = rulesElement.mapNotNull { ruleElement ->
        val ruleObj = ruleElement as? JsonObject ?: return@mapNotNull null
        val property = ruleObj["property"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
        val op = ruleObj["op"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
        val ruleValue = stringifyJson(ruleObj["value"])
        val type = ruleObj["type"]?.jsonPrimitive?.contentOrNull
        EntityGateRule(property, op, ruleValue, type)
    }
    return EntityGate(requirement ?: "all", rules)
}

private fun stringifyJson(element: JsonElement?): String {
    if (element == null) {
        return ""
    }
    if (element is JsonPrimitive) {
        return element.content
    }
    return element.toString()
}

private fun evaluateRule(rule: EntityGateRule, attributes: Map<String, Any?>): Boolean {
    val actualKey = findAttributeKey(attributes, rule.property) ?: return false
    val actual = attributes[actualKey]
    val op = rule.op.lowercase(Locale.ROOT)
    val valueType = rule.type ?: "string"

    if (op in equalityOps) {
        return compareEquality(actual, rule.value, op == "eq")
    }
    if (op in comparisonOps) {
        return compareOrdered(actual, rule.value, valueType, op)
    }
    if (op in inOps) {
        return compareIn(actual, rule.value)
    }
    if (op in containsOps) {
        return compareContains(actual, rule.value, valueType)
    }
    return false
}

private fun findAttributeKey(attributes: Map<String, Any?>, property: String): String? {
    if (attributes.containsKey(property)) {
        return property
    }
    val expected = property.lowercase(Locale.ROOT)
    return attributes.keys.find { it.lowercase(Locale.ROOT) == expected }
}

private fun stringifyActual(actual: Any?): String {
    if (actual == null) {
        return ""
    }
    if (actual is Double || actual is Float) {
        val number = (actual as Number).toDouble()
        return if (number % 1.0 == 0.0) number.toLong().toString() else number.toString()
    }
    return actual.toString()
}

private fun compareEquality(actual: Any?, expected: String, shouldEqual: Boolean): Boolean {
    val equal = stringifyActual(actual).equals(expected, ignoreCase = true)
    return if (shouldEqual) equal else !equal
}

private fun compareOrdered(actual: Any?, expected: String, valueType: String, op: String): Boolean {
    if (valueType == "datetime") {
        val actualDate = parseDateTime(actual) ?: return false
        val expectedDate = parseDateTime(expected) ?: return false
        return compareNumbers(actualDate.toDouble(), expectedDate.toDouble(), op)
    }
    if (valueType != "number") {
        return false
    }
    val actualNumber = parseNumber(actual) ?: return false
    val expectedNumber = parseNumber(expected) ?: return false
    return compareNumbers(actualNumber, expectedNumber, op)
}

private fun compareNumbers(actual: Double, expected: Double, op: String): Boolean {
    return when (op) {
        "gt" -> actual > expected
        "gte" -> actual >= expected
        "lt" -> actual < expected
        "lte" -> actual <= expected
        else -> false
    }
}

private fun compareIn(actual: Any?, expected: String): Boolean {
    val actualString = stringifyActual(actual)
    return expected.split(",")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .any { it.equals(actualString, ignoreCase = true) }
}

private fun compareContains(actual: Any?, expected: String, valueType: String): Boolean {
    if (valueType == "string[]" && actual is Iterable<*>) {
        return actual.any { stringifyActual(it).equals(expected, ignoreCase = true) }
    }
    return stringifyActual(actual).lowercase(Locale.ROOT).contains(expected.lowercase(Locale.ROOT))
}

private fun parseDateTime(value: Any?): Long? {
    when (value) {
        is Date -> return value.time
        is Number -> return value.toLong()
    }
    val text = stringifyActual(value)
    if (text.isEmpty()) {
        return null
    }
    text.toLongOrNull()?.let { return it }
    val patterns = arrayOf(
        "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
        "yyyy-MM-dd'T'HH:mm:ss'Z'",
        "yyyy-MM-dd'T'HH:mm:ss.SSSX",
        "yyyy-MM-dd'T'HH:mm:ssX",
        "yyyy-MM-dd"
    )
    for (pattern in patterns) {
        try {
            val format = SimpleDateFormat(pattern, Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            format.isLenient = false
            return format.parse(text)?.time
        } catch (_: Exception) {
            // try next pattern
        }
    }
    return null
}

private fun parseNumber(value: Any?): Double? {
    if (value is Number) {
        val number = value.toDouble()
        return if (number.isFinite()) number else null
    }
    val text = stringifyActual(value)
    if (text.isEmpty()) {
        return null
    }
    return text.toDoubleOrNull()
}

fun evaluateResolvedKeys(
    featureKeys: List<String>,
    requirementAll: Boolean,
    negate: Boolean,
    isEnabled: (String) -> Boolean
): Boolean {
    if (featureKeys.isEmpty()) {
        return !negate
    }
    val result = if (requirementAll) {
        featureKeys.all(isEnabled)
    } else {
        featureKeys.any(isEnabled)
    }
    return if (negate) !result else result
}

fun evaluateStoredFeatureKeys(
    features: EvaluatedDefinitions?,
    featureKeys: List<String>,
    requirementAll: Boolean,
    negate: Boolean,
    isEnabled: (String) -> Boolean
): Boolean {
    if (featureKeys.isNotEmpty() && (features == null || features.isEmpty())) {
        return negate
    }
    return evaluateResolvedKeys(featureKeys, requirementAll, negate, isEnabled)
}

fun evaluateEvaluatedGate(
    features: EvaluatedDefinitions,
    featureKeys: List<String>,
    requirementAll: Boolean = true,
    negate: Boolean = false,
    entityContext: TogglyEntityContext? = null
): Boolean {
    return evaluateStoredFeatureKeys(
        features,
        featureKeys,
        requirementAll,
        negate
    ) { key -> resolveEvaluatedDefinition(features[key], entityContext) }
}
