import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/cache_provider_contract.dart';

/// Minimal in-memory [TogglyCacheProvider] used to validate the conformance
/// contract itself and the interface wiring. Companion packages provide
/// persistent implementations.
class _InMemoryCacheProvider implements TogglyCacheProvider {
  final Map<String, TogglyFeatureFlagsCache> _flags = {};
  final Map<String, TogglyVariantsCache> _variants = {};
  String? _jwks;
  String? _lruIndex;

  @override
  Future<TogglyFeatureFlagsCache?> readFlags(String identity) async =>
      _flags[identity];

  @override
  Future<void> writeFlags(TogglyFeatureFlagsCache cache) async =>
      _flags[cache.identity] = cache;

  @override
  Future<void> deleteFlags(String identity) async => _flags.remove(identity);

  @override
  Future<TogglyVariantsCache?> readVariants(String identity) async =>
      _variants[identity];

  @override
  Future<void> writeVariants(TogglyVariantsCache cache) async =>
      _variants[cache.identity] = cache;

  @override
  Future<void> deleteVariants(String identity) async =>
      _variants.remove(identity);

  @override
  Future<String?> readJwks() async => _jwks;

  @override
  Future<void> writeJwks(String jwks) async => _jwks = jwks;

  @override
  Future<void> deleteJwks() async => _jwks = null;

  @override
  Future<String?> readCacheLruIndex() async => _lruIndex;

  @override
  Future<void> writeCacheLruIndex(String json) async => _lruIndex = json;
}

void main() {
  _InMemoryCacheProvider? current;

  runCacheProviderContract(
    () => current ??= _InMemoryCacheProvider(),
    reset: () => current = null,
  );
}
