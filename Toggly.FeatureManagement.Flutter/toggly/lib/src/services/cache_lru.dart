import 'dart:convert';

/// Pure LRU index helpers matching `@ops-ai/toggly-hooks-types` `cache-lru`.

/// One tracked cache key's last-access metadata.
class CacheLruEntry {
  final int lastAccessed;

  const CacheLruEntry({required this.lastAccessed});

  Map<String, dynamic> toJson() => {'lastAccessed': lastAccessed};

  factory CacheLruEntry.fromJson(Map<String, dynamic> json) => CacheLruEntry(
        lastAccessed: (json['lastAccessed'] as num).toInt(),
      );
}

/// Sidecar LRU index persisted by cache providers via
/// `readCacheLruIndex` / `writeCacheLruIndex`.
class CacheLruIndex {
  final Map<String, CacheLruEntry> entries;

  const CacheLruIndex({required this.entries});

  Map<String, dynamic> toJson() => {
        'entries': entries.map((key, value) => MapEntry(key, value.toJson())),
      };
}

/// Empty index with no tracked keys.
CacheLruIndex emptyCacheLruIndex() => const CacheLruIndex(entries: {});

/// Parses sidecar JSON; corrupt or missing payloads become an empty index.
CacheLruIndex parseCacheLruIndex(String? raw) {
  if (raw == null || raw.isEmpty) {
    return emptyCacheLruIndex();
  }

  try {
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      return emptyCacheLruIndex();
    }
    final entriesRaw = decoded['entries'];
    if (entriesRaw is! Map) {
      return emptyCacheLruIndex();
    }

    final entries = <String, CacheLruEntry>{};
    entriesRaw.forEach((key, value) {
      if (key is! String || value is! Map) {
        return;
      }
      final lastAccessed = value['lastAccessed'];
      if (lastAccessed is num) {
        entries[key] = CacheLruEntry(lastAccessed: lastAccessed.toInt());
      }
    });
    return CacheLruIndex(entries: entries);
  } catch (_) {
    return emptyCacheLruIndex();
  }
}

/// Serializes [index] to the JS-compatible JSON shape.
String serializeCacheLruIndex(CacheLruIndex index) =>
    jsonEncode(index.toJson());

/// Upserts [key] with [now] (epoch ms) as lastAccessed.
CacheLruIndex touchCacheLruKey(
  CacheLruIndex index,
  String key, {
  int? now,
}) {
  final timestamp = now ?? DateTime.now().millisecondsSinceEpoch;
  return CacheLruIndex(
    entries: {
      ...index.entries,
      key: CacheLruEntry(lastAccessed: timestamp),
    },
  );
}

/// Drops [keys] from the index.
CacheLruIndex removeCacheLruKeys(CacheLruIndex index, List<String> keys) {
  final entries = Map<String, CacheLruEntry>.from(index.entries);
  for (final key in keys) {
    entries.remove(key);
  }
  return CacheLruIndex(entries: entries);
}

/// Oldest keys to remove so [index] length is at most [maxKeys].
///
/// Skips [protectKey] / [protectKeys] (typically the key(s) just written for
/// the same evaluation context — e.g. flags + variants siblings).
List<String> selectCacheLruKeysToEvict(
  CacheLruIndex index,
  int maxKeys, {
  String? protectKey,
  Iterable<String>? protectKeys,
}) {
  if (maxKeys <= 0) {
    return const [];
  }

  final keys = index.entries.keys.toList();
  final over = keys.length - maxKeys;
  if (over <= 0) {
    return const [];
  }

  final protected = <String>{
    if (protectKey != null) protectKey,
    ...?protectKeys,
  };

  keys.sort((a, b) {
    final byAccess = index.entries[a]!.lastAccessed
        .compareTo(index.entries[b]!.lastAccessed);
    if (byAccess != 0) {
      return byAccess;
    }
    return a.compareTo(b);
  });

  final toEvict = <String>[];
  for (final key in keys) {
    if (toEvict.length >= over) {
      break;
    }
    if (protected.contains(key)) {
      continue;
    }
    toEvict.add(key);
  }

  return toEvict;
}

/// True when a positive finite max is configured.
bool isCacheLruEnabled(int? maxCacheKeys) {
  return maxCacheKeys != null && maxCacheKeys > 0;
}
