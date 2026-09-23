package io.toggly.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Evaluated variant assignment for one feature key, as returned by the
 * `evaluated-variants-signed` endpoint: `{ enabled, variant?, configurationValue? }`.
 *
 * Entity-gate fields (`requirement` / `rules`) that the server includes for
 * ungated definitions are ignored here, matching the current variant
 * evaluation scope of the JS and Flutter SDKs (gates stay evaluated through
 * the plain boolean/[EvaluatedDefinition.Gate] path; variants do not compose
 * with per-call entity context).
 */
internal data class EvaluatedVariantDef(
    val enabled: Boolean,
    val variant: String? = null,
    val configurationValue: Any? = null
)

internal fun parseVariantDefinitionValue(value: JsonElement): EvaluatedVariantDef {
    val obj = value as? JsonObject ?: return EvaluatedVariantDef(enabled = false)
    val enabled = (obj["enabled"] as? JsonPrimitive)?.booleanOrNull ?: false
    val variant = (obj["variant"] as? JsonPrimitive)?.contentOrNull
    val configurationValue = obj["configurationValue"]?.let(::jsonElementToKotlinValue)
    return EvaluatedVariantDef(enabled = enabled, variant = variant, configurationValue = configurationValue)
}

internal fun parseVariantDefinitions(element: JsonElement): Map<String, EvaluatedVariantDef> {
    val obj = element as? JsonObject
        ?: throw IllegalArgumentException("Variant definitions must be a JSON object")
    return obj.mapValues { (_, value) -> parseVariantDefinitionValue(value) }
}

internal fun parseVariantDefinitions(defsRaw: String): Map<String, EvaluatedVariantDef> {
    return parseVariantDefinitions(kotlinx.serialization.json.Json.parseToJsonElement(defsRaw))
}

/** Reduces variant assignments to plain booleans for gate/flag evaluation compatibility. */
internal fun variantDefinitionsToEvaluated(defs: Map<String, EvaluatedVariantDef>): EvaluatedDefinitions =
    defs.mapValues { (_, value) -> EvaluatedDefinition.BooleanValue(value.enabled) }

/**
 * Converts a JSON value into plain Kotlin types (String, Boolean, Long,
 * Double, Map, List, or null) for [EvaluatedVariantDef.configurationValue].
 * Respects the JSON string flag so a quoted `"true"` / `"42"` stays a String.
 */
internal fun jsonElementToKotlinValue(element: JsonElement): Any? = when (element) {
    is JsonNull -> null
    is JsonObject -> element.mapValues { (_, value) -> jsonElementToKotlinValue(value) }
    is JsonArray -> element.map { jsonElementToKotlinValue(it) }
    is JsonPrimitive -> when {
        element.isString -> element.content
        else -> element.booleanOrNull
            ?: element.longOrNull
            ?: element.doubleOrNull
            ?: element.content
    }
}
