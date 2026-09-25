package io.toggly.core

import kotlinx.serialization.InternalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.serializer

/**
 * Soft-decode a variant configuration value as [T].
 *
 * - Missing / null → null
 * - Runtime value already is [T] → value
 * - Otherwise rebuild JSON and decode with [serializer]; failure → null
 */
inline fun <reified T> decodeVariantValue(value: Any?): T? {
    if (value == null) return null
    if (value is T) return value
    return try {
        Json.Default.decodeFromJsonElement(serializer<T>(), kotlinValueToJsonElement(value))
    } catch (_: Exception) {
        null
    }
}

/**
 * Soft-decode using a Java [Class] (Java callers / non-reified).
 * Prefers [Class.isInstance]; otherwise kotlinx.serialization when annotated.
 */
@OptIn(InternalSerializationApi::class)
@Suppress("UNCHECKED_CAST")
fun <T : Any> decodeVariantValue(value: Any?, clazz: Class<T>): T? {
    if (value == null) return null
    if (clazz.isInstance(value)) return clazz.cast(value)
    return try {
        val ser = clazz.kotlin.serializer() as KSerializer<T>
        Json.Default.decodeFromJsonElement(ser, kotlinValueToJsonElement(value))
    } catch (_: Exception) {
        null
    }
}

/** Inverse of [jsonElementToKotlinValue] for soft re-decode. */
fun kotlinValueToJsonElement(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Int -> JsonPrimitive(value)
    is Long -> JsonPrimitive(value)
    is Float -> JsonPrimitive(value)
    is Double -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value.toDouble())
    is Map<*, *> -> JsonObject(
        value.entries.associate { (k, v) ->
            k.toString() to kotlinValueToJsonElement(v)
        }
    )
    is List<*> -> JsonArray(value.map { kotlinValueToJsonElement(it) })
    else -> JsonPrimitive(value.toString())
}

/**
 * Soft-decodes the assigned variant configuration as [T].
 * JVM-safe reified companion to [TogglyService.getVariantValue] / [Toggly.getVariantValue]
 * (those keep the untyped `Any?` and `Class<T>` overloads as members).
 */
suspend inline fun <reified T> TogglyService.getVariantValue(featureKey: String): T? =
    decodeVariantValue(getVariant(featureKey)?.configurationValue)

/** See [TogglyService.getVariantValue]. */
suspend inline fun <reified T> Toggly.getVariantValue(featureKey: String): T? =
    decodeVariantValue(getVariant(featureKey)?.configurationValue)
