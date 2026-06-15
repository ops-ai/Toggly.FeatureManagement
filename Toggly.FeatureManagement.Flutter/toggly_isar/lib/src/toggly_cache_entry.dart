import 'package:isar_community/isar.dart';

part 'toggly_cache_entry.g.dart';

/// Single Isar collection storing all Toggly cache entries.
///
/// Each entry is identified by a [cacheKey] of the form `flags:<identity>`,
/// `variants:<identity>`, or `jwks`. The integer [id] is derived from the
/// [cacheKey] so writes upsert deterministically.
@collection
class TogglyCacheEntry {
  TogglyCacheEntry({
    required this.cacheKey,
    required this.payload,
    required this.updatedAt,
  });

  /// Stable id derived from [cacheKey].
  Id get id => _fastHash(cacheKey);

  @Index(unique: true, replace: true)
  final String cacheKey;

  final String payload;

  final int updatedAt;
}

/// FNV-1a (64-bit) hash to derive stable Isar ids from string keys.
int _fastHash(String string) {
  var hash = 0xcbf29ce484222325;

  var i = 0;
  while (i < string.length) {
    final codeUnit = string.codeUnitAt(i++);
    hash ^= codeUnit >> 8;
    hash *= 0x100000001b3;
    hash ^= codeUnit & 0xFF;
    hash *= 0x100000001b3;
  }

  return hash;
}
