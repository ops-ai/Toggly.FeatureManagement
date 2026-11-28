/// Soft-decode resolved feature values by declared value type (OPS-2102/OPS-2107).
///
/// Mirrors the semantics of `toggly-eval`'s `feature-value-codec.ts`: never
/// throws for shape alone, never returns a wrong-typed value. A missing
/// [declaredType] (legacy catalogs without `valueType`) allows the decode
/// attempt; a declared type that disagrees with the requested getter soft-nulls.
library;

/// Prefer explicit catalog/evaluated `valueType`; soft-null when the getter
/// requests a type that disagrees with the declared one.
bool valueTypeMatches(String? declaredType, String requestedType) {
  if (declaredType == null || declaredType.isEmpty) {
    return true;
  }
  return declaredType == requestedType;
}

/// Soft-decodes [raw] as a [String]. Null/mismatch/non-string → null.
String? decodeStringValue(dynamic raw, String? declaredType) {
  if (!valueTypeMatches(declaredType, 'string')) {
    return null;
  }
  return raw is String ? raw : null;
}

/// Soft-decodes [raw] as a [num]. Accepts numeric strings; null/mismatch → null.
num? decodeNumberValue(dynamic raw, String? declaredType) {
  if (!valueTypeMatches(declaredType, 'number')) {
    return null;
  }
  if (raw is num) {
    return raw;
  }
  if (raw is String && raw.trim().isNotEmpty) {
    return num.tryParse(raw);
  }
  return null;
}

/// Soft-decodes [raw] as a JSON object/array, optionally mapping a [Map]
/// payload through [fromJson]. Soft-nulls on type mismatch or thrown
/// [fromJson] errors (never throws for shape alone).
T? decodeJsonValue<T>(
  dynamic raw,
  String? declaredType, [
  T Function(Map<String, dynamic>)? fromJson,
]) {
  if (!valueTypeMatches(declaredType, 'json') || raw == null) {
    return null;
  }
  if (fromJson == null) {
    return raw as T?;
  }
  if (raw is! Map) {
    return null;
  }
  try {
    return fromJson(Map<String, dynamic>.from(raw));
  } catch (_) {
    return null;
  }
}

/// Soft-decodes [raw] as a [DateTime] from an ISO-8601 wire string, an
/// existing [DateTime], or epoch milliseconds. Null/mismatch/unparseable → null.
DateTime? decodeDateTimeValue(dynamic raw, String? declaredType) {
  if (!valueTypeMatches(declaredType, 'datetime')) {
    return null;
  }
  if (raw is DateTime) {
    return raw;
  }
  if (raw is String && raw.trim().isNotEmpty) {
    return DateTime.tryParse(raw);
  }
  if (raw is num) {
    return DateTime.fromMillisecondsSinceEpoch(raw.toInt(), isUtc: true);
  }
  return null;
}
