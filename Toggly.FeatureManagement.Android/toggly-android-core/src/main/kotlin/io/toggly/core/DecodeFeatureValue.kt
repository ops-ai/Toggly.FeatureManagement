package io.toggly.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Soft-decodes resolved feature values by declared `valueType` (OPS-2102/OPS-2107).
 *
 * Mirrors `toggly-eval`'s `feature-value-codec.ts` semantics: never throws for
 * shape alone, never returns a wrong-typed value. A missing [declaredType]
 * (legacy catalogs) allows the decode attempt; a declared type that disagrees
 * with the requested getter soft-nulls.
 */

/** Prefer explicit catalog/evaluated `valueType`; soft-null on a getter/type disagreement. */
fun valueTypeMatches(declaredType: String?, requestedType: String): Boolean {
    if (declaredType.isNullOrEmpty()) return true
    return declaredType == requestedType
}

/** Soft-decodes [value] as a [String]. Null/mismatch/non-string → null. */
fun decodeStringValue(value: Any?, declaredType: String?): String? {
    if (!valueTypeMatches(declaredType, "string")) return null
    return value as? String
}

/** Soft-decodes [value] as a [Double]. Accepts numeric strings; null/mismatch → null. */
fun decodeNumberValue(value: Any?, declaredType: String?): Double? {
    if (!valueTypeMatches(declaredType, "number")) return null
    if (value is Number) {
        val number = value.toDouble()
        return if (number.isFinite()) number else null
    }
    val text = value as? String ?: return null
    if (text.isBlank()) return null
    return text.toDoubleOrNull()
}

/** Soft-decodes [value] as untyped JSON (Map/List/scalar). Null/mismatch → null. */
fun decodeJsonValue(value: Any?, declaredType: String?): Any? {
    if (!valueTypeMatches(declaredType, "json")) return null
    return value
}

/**
 * Soft-decodes [value] as [T] when the declared type matches `"json"`.
 * Delegates structural decoding to [decodeVariantValue].
 */
inline fun <reified T> decodeTypedJsonValue(value: Any?, declaredType: String?): T? {
    if (!valueTypeMatches(declaredType, "json")) return null
    return decodeVariantValue(value)
}

private val isoDateTimePatterns = arrayOf(
    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
    "yyyy-MM-dd'T'HH:mm:ss'Z'",
    "yyyy-MM-dd'T'HH:mm:ss.SSSX",
    "yyyy-MM-dd'T'HH:mm:ssX",
    "yyyy-MM-dd"
)

/**
 * Soft-decodes [value] as a [Date] from an ISO-8601 wire string, an existing
 * [Date], or epoch milliseconds. Null/mismatch/unparseable → null.
 */
fun decodeDateTimeValue(value: Any?, declaredType: String?): Date? {
    if (!valueTypeMatches(declaredType, "datetime")) return null
    when (value) {
        is Date -> return value
        is Number -> return Date(value.toLong())
    }
    val text = value as? String ?: return null
    if (text.isEmpty()) return null
    text.toLongOrNull()?.let { return Date(it) }
    for (pattern in isoDateTimePatterns) {
        try {
            val format = SimpleDateFormat(pattern, Locale.US)
            format.timeZone = TimeZone.getTimeZone("UTC")
            format.isLenient = false
            return format.parse(text)
        } catch (_: Exception) {
            // try next pattern
        }
    }
    return null
}
