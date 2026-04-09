import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:ecdsa/ecdsa.dart';
import 'package:elliptic/elliptic.dart';
import 'package:crypto/crypto.dart';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:uuid/uuid.dart';
import 'package:rxdart/rxdart.dart';

/// Static class providing feature flags support.
///
/// Allows enabling and disabling of features easily. Can be used with or without Toggly.io.
class Toggly with WidgetsBindingObserver {
  static const Uuid _uuid = Uuid();
  static late String? _appKey;
  static String _environment = 'Production';
  static bool _useSignedDefinitions = false;
  static late String _identity;
  static late TogglyConfig _config;
  static Map<String, bool> _flagDefaults = {};
  static final _http = HttpService.getInstance.http;
  static final _storage = SecureStorageService.getInstance;
  static final _sync = SyncService.getInstance;
  static BehaviorSubject<Map<String, bool>>? _featureFlagsSubject;
  static DateTime? _lastChecked;
  static DateTime? _lastSynced;
  static String? _eTag;
  static String? _lastError;
  // Add new static field for in-memory cache
  static Map<String, bool>? _inMemoryFlags;

  // Add new static field for in-memory JWKs cache
  static Map<String, dynamic>? _inMemoryJwks;

  /// Parsed `defs` map from the last successful variants response (feature key → payload).
  static Map<String, dynamic>? _inMemoryVariantDefs;

  static String? _variantsETag;

  static final Toggly _instance = Toggly._internal();

  Toggly._internal() {
    // Register for lifecycle events only if binding is available
    try {
      WidgetsBinding.instance.addObserver(this);
    } catch (e) {
      // Binding not available (e.g., in tests), skip observer registration
      if (kDebugMode) {
        print('Toggly: WidgetsBinding not available, skipping observer registration');
      }
    }
  }

  static Map<String, String?> debug() {
    return {
      'user': _identity,
      'appKey': _appKey,
      'environment': _environment,
      'useSignedDefinitions': _useSignedDefinitions.toString(),
      'isAppInForeground': _checkAppVisibility().toString(),
      'refreshInterval': Toggly._config.featureFlagsRefreshInterval.toString(),
      'syncServiceRunning':
          Toggly._sync.refreshFeatureFlagsTimer != null ? 'Yes' : 'No',
      'lastChecked': _lastChecked?.toString(),
      'lastSynced': _lastSynced?.toString(),
      'eTag': _eTag,
      'lastError': _lastError,
      'enableVariants': Toggly._config.enableVariants.toString(),
      'variantsETag': _variantsETag,
    };
  }

  static bool _checkAppVisibility() {
    try {
      final state = WidgetsBinding.instance.lifecycleState;
      // null lifecycleState means the app hasn't received any lifecycle
      // events yet (common in tests and on app startup) — treat as foreground
      return state == null || state == AppLifecycleState.resumed;
    } catch (e) {
      // Binding not available (e.g., in tests), assume app is in foreground
      return true;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (kDebugMode) {
      print(
          'Toggly: App state changed to ${_checkAppVisibility() ? "foreground" : "background"}');
    }

    // If app came to foreground, refresh flags if needed
    if (_checkAppVisibility()) {
      refresh();
    }
  }

  factory Toggly() => _instance;

  /// Initialize Toggly either by providing [flagDefaults] (to allow usage
  /// without Toggly.io) or by providing your [appKey] and [environment] from
  /// your Toggly.io application.
  ///
  /// You can also set various configuration settings through [config], such as
  /// baseUri, connectTimeout or featureFlagsRefreshInterval
  static Future<TogglyInitResponse> init({
    String? appKey,
    String? environment,
    String? identity,
    bool useSignedDefinitions = false,
    TogglyConfig config = const TogglyConfig(),
    Map<String, bool>? flagDefaults,
  }) async {
    // Create new subject if needed
    _featureFlagsSubject?.close();
    _featureFlagsSubject = BehaviorSubject<Map<String, bool>>();

    Toggly._appKey = appKey;
    Toggly._environment = environment ?? 'Production';

    // Use provided identity or get/generate device ID
    if (identity != null) {
      Toggly._identity = identity;
      await checkAndClearFeatureFlagsCache();
    } else {
      // Try to get stored device ID
      var storedId =
          await _storage.get(key: SecureStorageKeys.deviceId.toString());
      if (storedId == null) {
        // Generate new device ID if none exists
        storedId = _uuid.v4();
        await _storage.set(
          key: SecureStorageKeys.deviceId.toString(),
          value: storedId,
        );
      }
      Toggly._identity = storedId;
      await checkAndClearFeatureFlagsCache();
    }

    Toggly._config = config;
    Toggly._flagDefaults = flagDefaults ?? {};
    Toggly._useSignedDefinitions = useSignedDefinitions;
    if (kDebugMode) {
      print('Toggly.init');
    }

    Toggly.startTimers();

    final result = await Toggly.refresh();

    // Start WebSocket for live updates after a successful first refresh
    if (Toggly._config.enableLiveUpdates && Toggly._appKey != null) {
      Toggly._startWebSocket();
    }

    return result;
  }

  /// Refreshes the feature flag values.
  ///
  /// In case there is no API key provided, only the flag defaults shall be
  /// used.
  ///
  /// Otherwise fetch feature flags values from the Toggly Client API. If
  /// that fails it loads feature flags from cache and defaults to the
  /// previously provided [flagDefaults] during [init]
  static Future<TogglyInitResponse> refresh() async {
    final appInForeground = _checkAppVisibility();

    if (kDebugMode) {
      print('Toggly.refresh - App in foreground: $appInForeground');
    }

    // Skip refresh if app is not in foreground
    if (!appInForeground) {
      if (kDebugMode) {
        print('Skipping refresh as app is not in foreground');
      }
      return TogglyInitResponse(
        status: TogglyLoadFeatureFlagsResponse.cached,
      );
    }

    // In case there is no API key provided, only the flag defaults shall be used
    if (Toggly._appKey == null) {
      Toggly._featureFlagsSubject?.add(Toggly._flagDefaults);

      return TogglyInitResponse(
        status: TogglyLoadFeatureFlagsResponse.defaults,
      );
    }

    // Try to fetch flags from the API
    final status = await Toggly.fetchFeatureFlags();

    if (Toggly._config.enableVariants && Toggly._appKey != null) {
      await Toggly.fetchEvaluatedVariants();
    }

    return TogglyInitResponse(
      status: status,
    );
  }

  /// Sets an unique identifier to the current session. Useful in case of custom
  /// feature rollouts.
  static Future<TogglyInitResponse> setIdentity(String? identity) async {
    if (identity != null) {
      if (Toggly._identity != identity) {
        await clearFeatureFlagsCache();
      }
      Toggly._identity = identity;
    } else {
      // Try to get stored device ID
      var storedId =
          await _storage.get(key: SecureStorageKeys.deviceId.toString());
      if (storedId == null) {
        // Generate new device ID if none exists
        storedId = _uuid.v4();
        await _storage.set(
          key: SecureStorageKeys.deviceId.toString(),
          value: storedId,
        );
      }
      if (Toggly._identity != storedId) {
        await clearFeatureFlagsCache();
      }
      Toggly._identity = storedId;
    }
    return await Toggly.refresh();
  }

  /// Returns a [Future] with the cached feature flags values.
  static Future<Map<String, bool>> get cachedFeatureFlags async {
    try {
      // Return in-memory flags if available to avoid secure storage access
      if (_inMemoryFlags != null) {
        return _inMemoryFlags!;
      }

      // If app is backgrounded, return defaults from memory to avoid secure storage access
      if (!_checkAppVisibility()) {
        return Map<String, bool>.from(Toggly._flagDefaults);
      }

      final hashedIdentity =
          sha256.convert(utf8.encode(Toggly._identity)).toString();

      String? cache = await _storage.get(
          key: SecureStorageKeys.featureFlagsCache.toString() + hashedIdentity);

      if (cache == null) {
        // If no cache exists, return defaults
        return Map<String, bool>.from(Toggly._flagDefaults);
      }

      TogglyFeatureFlagsCache flagsCache = TogglyFeatureFlagsCache.fromJson(
        jsonDecode(cache),
      );

      // Check if the cache is signed and if the timestamp and signature are present
      if (Toggly._useSignedDefinitions) {
        if (flagsCache.timestamp == null || flagsCache.signature == null) {
          throw Exception(
              'Timestamp and signature are required for signed definitions');
        }

        // Validate the signature
        final isValid = await _verifySignature(
            flagsCache.flags,
            flagsCache.signature!,
            flagsCache.timestamp!,
            true,
            flagsCache.keyId!);

        if (!isValid) {
          _lastError = 'Invalid signature';
          throw Exception('Invalid signature');
        }
      }

      if (flagsCache.identity == Toggly._identity) {
        _inMemoryFlags = Map<String, bool>.from(jsonDecode(flagsCache.flags));
        return _inMemoryFlags!;
      }
    } catch (_) {
      _lastError = 'Error fetching cached feature flags';
      if (kDebugMode) {
        print('Error fetching cached feature flags');
      }
      await clearFeatureFlagsCache();
    }

    return Map<String, bool>.from(Toggly._flagDefaults);
  }

  /// Stores the provided [featureFlags] into cache.
  static void cacheFeatureFlags({
    required String featureFlags,
    int? timestamp,
    String? signature,
    String? keyId,
  }) async {
    // Update in-memory cache first
    _inMemoryFlags = Map<String, bool>.from(jsonDecode(featureFlags));

    // Skip secure storage operations if app is backgrounded
    if (!_checkAppVisibility()) {
      if (kDebugMode) {
        print('Skipping secure storage cache as app is not in foreground');
      }
      return;
    }

    if (Toggly._useSignedDefinitions) {
      if (timestamp == null || signature == null || keyId == null) {
        throw Exception(
            'Timestamp, signature and keyId are required for signed definitions');
      }
    }

    final hashedIdentity =
        sha256.convert(utf8.encode(Toggly._identity)).toString();

    await _storage.set(
      key: SecureStorageKeys.featureFlagsCache.toString() + hashedIdentity,
      value: jsonEncode(TogglyFeatureFlagsCache(
        identity: Toggly._identity,
        flags: featureFlags,
        timestamp: timestamp,
        signature: signature,
        keyId: keyId,
      )),
    );
  }

  /// Clears the feature flags cache.
  static Future clearFeatureFlagsCache() async {
    _inMemoryFlags = null;
    _inMemoryVariantDefs = null;
    _featureFlagsSubject?.add({});
    _eTag = null;
    _variantsETag = null;

    // Skip secure storage operations if app is backgrounded
    if (!_checkAppVisibility()) {
      if (kDebugMode) {
        print('Skipping secure storage clear as app is not in foreground');
      }
      return;
    }

    final hashedIdentity =
        sha256.convert(utf8.encode(Toggly._identity)).toString();

    await _storage.delete(
      key: SecureStorageKeys.featureFlagsCache.toString() + hashedIdentity,
    );
    await _storage.delete(
      key: SecureStorageKeys.variantsCache.toString() + hashedIdentity,
    );
    await _storage.delete(key: SecureStorageKeys.etag.toString());
    await _storage.delete(key: SecureStorageKeys.etagVariants.toString());
  }

  static Future checkAndClearFeatureFlagsCache() async {
    // Skip secure storage operations if app is backgrounded
    if (!_checkAppVisibility()) {
      if (kDebugMode) {
        print('Skipping cache check as app is not in foreground');
      }
      return;
    }

    final hashedIdentity =
        sha256.convert(utf8.encode(Toggly._identity)).toString();

    String? cache = await _storage.get(
        key: SecureStorageKeys.featureFlagsCache.toString() + hashedIdentity);

    if (cache == null) {
      return;
    }

    TogglyFeatureFlagsCache flagsCache = TogglyFeatureFlagsCache.fromJson(
      jsonDecode(cache),
    );

    if (Toggly._identity != flagsCache.identity) {
      await clearFeatureFlagsCache();
      return;
    }

    String? variantsCacheStr = await _storage.get(
        key: SecureStorageKeys.variantsCache.toString() + hashedIdentity);
    if (variantsCacheStr != null) {
      final variantsCache = TogglyVariantsCache.fromJson(
        jsonDecode(variantsCacheStr),
      );
      if (Toggly._identity != variantsCache.identity) {
        await clearVariantCache();
      }
    }
  }

  /// Returns the feature flags default values provided during [init]
  static Map<String, bool> get featureFlagDefaults {
    return Toggly._flagDefaults;
  }

  /// Retrieves feature flags values from the Toggly.io Client API.
  static Future<TogglyLoadFeatureFlagsResponse> fetchFeatureFlags() async {
    try {
      // Prepare headers
      Map<String, dynamic> headers = {};

      if (Toggly._useSignedDefinitions) {
        String? etag =
            _eTag ?? await _storage.get(key: SecureStorageKeys.etag.toString());
        if (etag != null) {
          headers['If-None-Match'] = etag;
        }
      }

      final response = await _http.get(
        '${Toggly._config.baseURI}/evaluated-signed/${Toggly._appKey}/${Toggly._environment}?u=${Toggly._identity}',
        queryParameters: {},
        options: Options(headers: headers),
      );

      if (kDebugMode) {
        print('Raw response: ${response.data}');
      }

      Map<String, bool> flags;

      if (Toggly._useSignedDefinitions) {
        // Parse the response
        final signedResponse = Map<String, dynamic>.from(response.data);
        flags = Map<String, bool>.from(signedResponse['defs'] ?? signedResponse['data'] ?? <String, dynamic>{});
        String signature = signedResponse['signature'];
        int timestamp = signedResponse['timestamp'];
        String keyId = signedResponse['kid'];

        final hashedIdentity =
            sha256.convert(utf8.encode(Toggly._identity)).toString();

        // Check existing cache timestamp
        String? existingCache = await _storage.get(
            key: SecureStorageKeys.featureFlagsCache.toString() +
                hashedIdentity);

        if (existingCache != null) {
          TogglyFeatureFlagsCache existing = TogglyFeatureFlagsCache.fromJson(
            jsonDecode(existingCache),
          );

          // Validate that new timestamp is greater than existing
          if (existing.timestamp != null && timestamp <= existing.timestamp!) {
            throw Exception(
                'New definitions timestamp must be greater than existing timestamp');
          }
        }

        try {
          final flagsPayload = signedResponse['defs'] ?? signedResponse['data'];
          if (Toggly._config.verifySignatures) {
            final isValid = await _verifySignature(
              jsonEncode(flagsPayload),
              signature,
              timestamp,
              false,
              keyId);

            if (!isValid) {
              throw Exception('Invalid signature');
            }
            if (kDebugMode) {
              print('Signature verification successful');
            }
          }
          _lastChecked = DateTime.now();
          _lastSynced = DateTime.now();
          Toggly.cacheFeatureFlags(
              featureFlags: jsonEncode(flagsPayload),
              timestamp: timestamp,
              signature: signature,
              keyId: keyId);
        } catch (e, stack) {
          if (kDebugMode) {
            print('Signature verification failed: $e');
            print('Stack trace: $stack');
          }
          _lastError = 'Signature verification failed';
          throw Exception('Signature verification failed');
        }

        // Store new ETag if present
        String? newEtag = response.headers['etag']?.first;
        if (newEtag != null) {
          _eTag = newEtag;
          await _storage.set(
            key: SecureStorageKeys.etag.toString(),
            value: newEtag,
          );
        }
      } else {
        _lastChecked = DateTime.now();
        _lastSynced = DateTime.now();
        final payload = Map<String, dynamic>.from(response.data);
        flags = Map<String, bool>.from(payload['defs'] ?? payload);
        Toggly.cacheFeatureFlags(featureFlags: jsonEncode(payload['defs'] ?? payload));

        // Store new ETag if present
        String? newEtag = response.headers['etag']?.first;
        if (newEtag != null) {
          _eTag = newEtag;
          await _storage.set(
            key: SecureStorageKeys.etag.toString(),
            value: newEtag,
          );
        }
      }

      // Cache flags on successful response
      Toggly._featureFlagsSubject?.add(flags);

      if (kDebugMode) {
        print('Toggly.fetchFeatureFlags - ${jsonEncode(flags)}');
      }

      return TogglyLoadFeatureFlagsResponse.fetched;
    } catch (e) {
      if (e is DioException && e.response?.statusCode == 304) {
        _lastChecked = DateTime.now();
        // Not modified, use cached version
        var cached = await cachedFeatureFlags;
        Toggly._featureFlagsSubject?.add(cached);
        return TogglyLoadFeatureFlagsResponse.cached;
      } else if (e is DioException && e.response?.statusCode == 403) {
        // Clear cached data on 403 responses
        await clearFeatureFlagsCache();
        await _storage.delete(key: SecureStorageKeys.jwks.toString());

        return TogglyLoadFeatureFlagsResponse.error;
      }

      return TogglyLoadFeatureFlagsResponse.defaults;
    }
  }

  /// Fetches signed variant assignments from the Client API.
  static Future<void> fetchEvaluatedVariants() async {
    if (!Toggly._config.enableVariants || Toggly._appKey == null) {
      return;
    }
    if (!_checkAppVisibility()) {
      return;
    }
    try {
      final headers = <String, dynamic>{};
      final etag = _variantsETag ??
          await _storage.get(key: SecureStorageKeys.etagVariants.toString());
      if (etag != null) {
        headers['If-None-Match'] = etag;
      }

      final response = await _http.get(
        '${Toggly._config.baseURI}/evaluated-variants-signed/${Toggly._appKey}/${Toggly._environment}',
        queryParameters: <String, dynamic>{'userId': Toggly._identity},
        options: Options(headers: headers),
      );

      if (kDebugMode) {
        print('Toggly variants raw response: ${response.data}');
      }

      final signedResponse = Map<String, dynamic>.from(response.data);
      final defsPayload =
          signedResponse['defs'] ?? signedResponse['data'] ?? <String, dynamic>{};
      final defs = defsPayload is Map
          ? Map<String, dynamic>.from(defsPayload)
          : <String, dynamic>{};

      final signature = signedResponse['signature'] as String?;
      final timestamp = signedResponse['timestamp'] as int?;
      final keyId = signedResponse['kid'] as String?;
      if (signature == null || timestamp == null || keyId == null) {
        throw Exception('Variants response missing signature metadata');
      }

      final hashedIdentity =
          sha256.convert(utf8.encode(Toggly._identity)).toString();

      final existingVariantsCache = await _storage.get(
          key: SecureStorageKeys.variantsCache.toString() + hashedIdentity);

      if (existingVariantsCache != null) {
        final existing = TogglyVariantsCache.fromJson(
          jsonDecode(existingVariantsCache),
        );
        if (existing.timestamp != null && timestamp <= existing.timestamp!) {
          throw Exception(
              'New variants timestamp must be greater than existing timestamp');
        }
      }

      final payloadForSign = jsonEncode(defsPayload is Map ? defsPayload : defs);
      if (Toggly._config.verifySignatures) {
        final isValid = await _verifySignature(
          payloadForSign,
          signature,
          timestamp,
          false,
          keyId,
        );
        if (!isValid) {
          throw Exception('Invalid variants signature');
        }
        if (kDebugMode) {
          print('Toggly variants signature verification successful');
        }
      }

      _lastChecked = DateTime.now();
      _lastSynced = DateTime.now();
      await _persistVariantsCache(
        variantsJson: jsonEncode(defs),
        timestamp: timestamp,
        signature: signature,
        keyId: keyId,
      );

      final newEtag = response.headers['etag']?.first;
      if (newEtag != null) {
        _variantsETag = newEtag;
        await _storage.set(
          key: SecureStorageKeys.etagVariants.toString(),
          value: newEtag,
        );
      }

      if (kDebugMode) {
        print('Toggly.fetchEvaluatedVariants — ${jsonEncode(defs)}');
      }
    } on DioException catch (e) {
      if (e.response?.statusCode == 304) {
        _lastChecked = DateTime.now();
        final cached = await _readVerifiedVariantDefsFromCache();
        _inMemoryVariantDefs = cached;
      } else if (e.response?.statusCode == 403) {
        await clearVariantCache();
        await _storage.delete(key: SecureStorageKeys.jwks.toString());
      } else {
        if (kDebugMode) {
          print('Toggly.fetchEvaluatedVariants error: $e');
        }
      }
    } catch (e, stack) {
      if (kDebugMode) {
        print('Toggly.fetchEvaluatedVariants error: $e');
        print('Stack trace: $stack');
      }
      _lastError = 'Variants fetch failed';
    }
  }

  static Future<void> _persistVariantsCache({
    required String variantsJson,
    required int timestamp,
    required String signature,
    required String keyId,
  }) async {
    _inMemoryVariantDefs = Map<String, dynamic>.from(jsonDecode(variantsJson));

    if (!_checkAppVisibility()) {
      if (kDebugMode) {
        print('Skipping variants secure storage cache as app is not in foreground');
      }
      return;
    }

    final hashedIdentity =
        sha256.convert(utf8.encode(Toggly._identity)).toString();

    await _storage.set(
      key: SecureStorageKeys.variantsCache.toString() + hashedIdentity,
      value: jsonEncode(TogglyVariantsCache(
        identity: Toggly._identity,
        variants: variantsJson,
        timestamp: timestamp,
        signature: signature,
        keyId: keyId,
      )),
    );
  }

  /// Drops variant cache from memory and secure storage for the current identity.
  static Future<void> clearVariantCache() async {
    _inMemoryVariantDefs = null;
    _variantsETag = null;

    if (!_checkAppVisibility()) {
      if (kDebugMode) {
        print('Skipping variant cache clear as app is not in foreground');
      }
      return;
    }

    final hashedIdentity =
        sha256.convert(utf8.encode(Toggly._identity)).toString();

    await _storage.delete(
      key: SecureStorageKeys.variantsCache.toString() + hashedIdentity,
    );
    await _storage.delete(key: SecureStorageKeys.etagVariants.toString());
  }

  static Future<Map<String, dynamic>> _readVerifiedVariantDefsFromCache() async {
    try {
      if (!_checkAppVisibility()) {
        return {};
      }
      final hashedIdentity =
          sha256.convert(utf8.encode(Toggly._identity)).toString();
      final cache = await _storage.get(
          key: SecureStorageKeys.variantsCache.toString() + hashedIdentity);
      if (cache == null) {
        return {};
      }
      final vc = TogglyVariantsCache.fromJson(jsonDecode(cache));
      if (vc.identity != Toggly._identity) {
        return {};
      }

      final mustVerify =
          Toggly._useSignedDefinitions || Toggly._config.verifySignatures;
      if (mustVerify) {
        if (vc.timestamp == null || vc.signature == null || vc.keyId == null) {
          throw Exception('Variants cache missing signature metadata');
        }
        final isValid = await _verifySignature(
          vc.variants,
          vc.signature!,
          vc.timestamp!,
          true,
          vc.keyId!,
        );
        if (!isValid) {
          _lastError = 'Invalid variants signature';
          throw Exception('Invalid variants signature');
        }
      }

      return Map<String, dynamic>.from(jsonDecode(vc.variants));
    } catch (_) {
      await clearVariantCache();
      return {};
    }
  }

  /// Variant definitions map (feature key → server payload), from memory or verified cache.
  static Future<Map<String, dynamic>> cachedVariantDefinitions() async {
    if (!Toggly._config.enableVariants) {
      return {};
    }
    try {
      if (_inMemoryVariantDefs != null) {
        return _inMemoryVariantDefs!;
      }
      if (!_checkAppVisibility()) {
        return {};
      }
      final defs = await _readVerifiedVariantDefsFromCache();
      _inMemoryVariantDefs = defs;
      return defs;
    } catch (_) {
      if (kDebugMode) {
        print('Error loading cached variant definitions');
      }
      return {};
    }
  }

  static VariantResult _variantResultFromDef(dynamic raw) {
    if (raw is! Map) {
      return const VariantResult(
        enabled: false,
        name: null,
        configurationValue: null,
      );
    }
    final m = Map<String, dynamic>.from(raw);
    return VariantResult(
      enabled: m['enabled'] == true,
      name: m['variant'] as String?,
      configurationValue: m['configurationValue'],
    );
  }

  /// Returns variant assignment for [featureKey].
  static Future<VariantResult> getVariant(String featureKey) async {
    if (!Toggly._config.enableVariants) {
      return const VariantResult(
        enabled: false,
        name: null,
        configurationValue: null,
      );
    }
    final defs = await cachedVariantDefinitions();
    final raw = defs[featureKey];
    if (raw == null) {
      return const VariantResult(
        enabled: false,
        name: null,
        configurationValue: null,
      );
    }
    return _variantResultFromDef(raw);
  }

  /// Returns [VariantResult.configurationValue] for [featureKey], or null if none.
  static Future<dynamic> getVariantValue(String featureKey) async {
    final r = await getVariant(featureKey);
    return r.configurationValue;
  }

  /// Fetches and caches JWKs from the server
  static Future<Map<String, dynamic>?> _fetchAndCacheJwks({
    bool ignoreExpiration = true,
  }) async {
    try {
      // Check in-memory cache first
      if (_inMemoryJwks != null) {
        final keys = List<Map<String, dynamic>>.from(_inMemoryJwks!['keys']);
        if (_validateJwks(keys)) {
          if (ignoreExpiration ||
              _inMemoryJwks!['_expiresAt'] == null ||
              _inMemoryJwks!['_expiresAt'] >=
                  DateTime.now().millisecondsSinceEpoch) {
            if (kDebugMode) {
              print('Using in-memory JWKs');
            }
            return _inMemoryJwks;
          }
        }
      }

      // Skip secure storage operations if app is backgrounded
      if (!_checkAppVisibility()) {
        if (kDebugMode) {
          print('Skipping JWKs fetch as app is not in foreground');
        }
        return null;
      }

      // Try to get cached JWKs from storage
      var cachedJwks =
          await _storage.get(key: SecureStorageKeys.jwks.toString());
      if (cachedJwks != null) {
        if (kDebugMode) {
          print('Using cached JWKs from storage');
        }
        final jwksData = jsonDecode(cachedJwks);

        // Validate cached keys
        final keys = List<Map<String, dynamic>>.from(jwksData['keys']);
        if (!_validateJwks(keys)) {
          if (kDebugMode) {
            print('Cached JWKs validation failed, fetching new ones');
          }
          _lastError = 'Invalid cached JWKs';
        } else if (ignoreExpiration ||
            jwksData['_expiresAt'] == null ||
            jwksData['_expiresAt'] >= DateTime.now().millisecondsSinceEpoch) {
          _inMemoryJwks = jwksData; // Cache in memory
          return jwksData;
        }
      }

      // Fetch JWKs from server
      final jwksResponse = await _http.get(
        '${Toggly._config.baseURI}/.well-known/jwks',
        queryParameters: {},
      );

      final jwksData = Map<String, dynamic>.from(jwksResponse.data);
      final keys = List<Map<String, dynamic>>.from(jwksData['keys']);

      // Validate fetched keys
      if (!_validateJwks(keys)) {
        _lastError = 'Invalid JWKs received from server';
        throw Exception('Invalid JWKs received from server');
      }

      jwksData['_expiresAt'] =
          DateTime.now().add(const Duration(days: 30)).millisecondsSinceEpoch;

      // Cache in memory
      _inMemoryJwks = jwksData;

      // Cache in storage
      await _storage.set(
        key: SecureStorageKeys.jwks.toString(),
        value: jsonEncode(jwksData),
      );

      if (kDebugMode) {
        print('Fetched and cached new JWKs');
      }

      return jwksData;
    } catch (e) {
      if (kDebugMode) {
        print('Error fetching JWKs: $e');
      }
      _lastError = 'Error fetching JWKs';
      return null;
    }
  }

  /// Validates JWKs by computing and checking their key IDs
  static bool _validateJwks(List<Map<String, dynamic>> keys) {
    try {
      for (var key in keys) {
        if (key['x'] == null || key['y'] == null) {
          if (kDebugMode) {
            print('Invalid JWK: missing x or y coordinates');
          }
          _lastError = 'Invalid JWK: missing x or y coordinates';
          return false;
        }

        // Pad base64url strings and decode
        String padBase64(String value) {
          var output = value.replaceAll('-', '+').replaceAll('_', '/');
          switch (output.length % 4) {
            case 0:
              break;
            case 2:
              output += '==';
              break;
            case 3:
              output += '=';
              break;
            default:
              throw Exception('Illegal base64url string');
          }
          return output;
        }

        // Decode X and Y coordinates
        final xBytes = base64Url.decode(padBase64(key['x']));
        final yBytes = base64Url.decode(padBase64(key['y']));

        // Concatenate X and Y bytes
        final List<int> kidInput = [...xBytes, ...yBytes];

        // Compute SHA1 hash
        final hash = sha1.convert(kidInput);

        // Convert to uppercase hex string and append ES256
        final computedKid =
            '${hash.bytes.map((b) => b.toRadixString(16).padLeft(2, '0').toUpperCase()).join()}ES256';

        // Verify key ID matches computed value
        if (key['kid'] != computedKid) {
          if (kDebugMode) {
            print(
                'Invalid key ID in JWK. Expected: $computedKid, Got: ${key['kid']}');
          }
          _lastError = 'Invalid key ID in JWK';
          return false;
        }
      }
      return true;
    } catch (e) {
      if (kDebugMode) {
        print('Error validating JWKs: $e');
      }
      _lastError = 'Error validating JWKs';
      return false;
    }
  }

  /// Verifies the signature of feature flags data
  static Future<bool> _verifySignature(String flags, String signature,
      int timestamp, bool allowOfflineValidation, String keyId) async {
    // Check if keyId is in whitelist if one is provided
    if (Toggly._config.trustedKeyIds != null &&
        !Toggly._config.trustedKeyIds!.contains(keyId)) {
      _lastError = 'Key ID not in trusted whitelist';
      throw Exception('Key ID not in trusted whitelist');
    }

    // Get JWKs
    final jwksData =
        await _fetchAndCacheJwks(ignoreExpiration: allowOfflineValidation);
    if (jwksData == null) {
      _lastError = 'Failed to fetch JWKs';
      throw Exception('Failed to fetch JWKs');
    }

    final jwksList = List<Map<String, dynamic>>.from(jwksData['keys']);

    // Find matching key
    final matchingKeys = jwksList.where((jwk) => jwk['kid'] == keyId);
    if (matchingKeys.isEmpty) {
      _lastError = 'No matching key found for ID: $keyId';
      throw Exception('No matching key found for ID: $keyId');
    }
    final jwk = matchingKeys.first;

    // Create data string to verify and hash it with SHA-256
    final dataToVerify = '$flags|$timestamp';
    final messageHash = sha256.convert(utf8.encode(dataToVerify)).bytes;

    try {
      if (jwk['x'] == null || jwk['y'] == null) {
        _lastError = 'Invalid JWK: missing x or y coordinates';
        throw Exception('Invalid JWK: missing x or y coordinates');
      }

      if (kDebugMode) {
        print('Data to verify: $dataToVerify');
        print('Timestamp: $timestamp');
        print('Signature (base64): $signature');
      }
      if (kDebugMode) {
        print(
            'Message hash (hex): ${messageHash.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}');
      }

      // Create EC public key from JWK components
      final ec = getP256();

      // Pad base64url strings and decode
      String padBase64(String value) {
        var output = value.replaceAll('-', '+').replaceAll('_', '/');
        switch (output.length % 4) {
          case 0:
            break;
          case 2:
            output += '==';
            break;
          case 3:
            output += '=';
            break;
          default:
            throw Exception('Illegal base64url string');
        }
        return output;
      }

      final publicKey = PublicKey(
          ec,
          BigInt.parse(
              base64Url
                  .decode(padBase64(jwk['x']))
                  .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
                  .join(),
              radix: 16),
          BigInt.parse(
              base64Url
                  .decode(padBase64(jwk['y']))
                  .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
                  .join(),
              radix: 16));

      // Decode signature from base64
      final sigBytes = base64.decode(signature);

      if (kDebugMode) {
        print('Signature bytes length: ${sigBytes.length}');
        print(
            'R bytes: ${sigBytes.sublist(0, 32).map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}');
        print(
            'S bytes: ${sigBytes.sublist(32).map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}');
      }

      // ES256 signature is 64 bytes: first 32 bytes are R, last 32 bytes are S
      final r = BigInt.parse(
          sigBytes
              .sublist(0, 32)
              .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
              .join(),
          radix: 16);
      final s = BigInt.parse(
          sigBytes
              .sublist(32)
              .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
              .join(),
          radix: 16);

      if (kDebugMode) {
        print('R: $r');
        print('S: $s');
      }

      // Verify signature
      final sig = Signature.fromRS(r, s);
      final isValid = verify(publicKey, messageHash, sig);

      return isValid;
    } catch (e, stack) {
      if (kDebugMode) {
        print('Signature verification failed: $e');
        print('Stack trace: $stack');
      }
      _lastError = 'Signature verification failed';
      throw Exception('Signature verification failed');
    }
  }

  static Future<bool> evaluateFeatureGate(
    List<String> gate, {
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) async {
    // Fast path: use in-memory flags if available
    return _evaluateFeatureGate(await cachedFeatureFlags,
        gate: gate, requirement: requirement, negate: negate);
  }

  // Optimize the evaluation logic
  static bool _evaluateFeatureGate(
    Map<String, bool> flags, {
    required List<String> gate,
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) {
    // Fast path for single flag
    if (gate.length == 1) {
      final isEnabled = flags[gate.first] ?? false;
      return negate ? !isEnabled : isEnabled;
    }

    // Fast path for ALL requirement
    if (requirement == FeatureRequirement.all) {
      for (final featureKey in gate) {
        if (!(flags[featureKey] ?? false)) {
          return negate;
        }
      }
      return !negate;
    }

    // ANY requirement
    for (final featureKey in gate) {
      if (flags[featureKey] ?? false) {
        return !negate;
      }
    }
    return negate;
  }

  /// Cancels registered timers and closes the feature flags stream.
  static void dispose() {
    cancelTimers();
    _inMemoryFlags = null;
    _inMemoryVariantDefs = null;
    _variantsETag = null;
    _inMemoryJwks = null; // Clear JWKs cache
    _featureFlagsSubject?.close();
    _featureFlagsSubject = null;

    // Remove lifecycle observer only if binding is available
    try {
      WidgetsBinding.instance.removeObserver(_instance);
    } catch (e) {
      // Binding not available (e.g., in tests), skip observer removal
      if (kDebugMode) {
        print('Toggly: WidgetsBinding not available, skipping observer removal');
      }
    }
  }

  /// Starts a [Timer] to periodically retrieve the feature flags values from
  /// the Toggly.io Client API.
  ///
  /// It only registers the timer if an [appKey] is provided during the [init]
  /// call.
  static void startTimers() {
    cancelTimers();

    // Automatic refresh only runs if there is an API key provided
    if (Toggly._appKey != null) {
      Toggly._sync.refreshFeatureFlagsTimer = Timer.periodic(
        Duration(milliseconds: Toggly._config.featureFlagsRefreshInterval),
        (timer) async {
          if (kDebugMode) {
            print(
                'Toggly.syncFeatureFlags - every ${Toggly._config.featureFlagsRefreshInterval / 1000}s');
          }

          // When WebSocket is connected, skip polling entirely — live
          // updates are handled by the WebSocket. Polling resumes
          // automatically once the connection drops.
          if (Toggly._sync.wsConnected) {
            if (kDebugMode) {
              print(
                  'Toggly: Skipping poll refresh — WebSocket is connected');
            }
            return;
          }

          // Only refresh if app is in foreground
          if (_checkAppVisibility()) {
            await Toggly.refresh();
          } else if (kDebugMode) {
            print('Skipping refresh as app is not in foreground');
          }
        },
      );
    }
  }

  /// Starts the WebSocket connection for live feature flag updates.
  static void _startWebSocket() {
    Toggly._sync.onFlagsUpdated = () async {
      if (kDebugMode) {
        print('Toggly: WebSocket triggered refresh');
      }
      await Toggly.refresh();
    };

    Toggly._sync.startWebSocket(
      baseURI: Toggly._config.baseURI,
      appKey: Toggly._appKey!,
    );
  }

  /// Cancels the registered timers and stops the WebSocket connection.
  static void cancelTimers() {
    Toggly._sync.refreshFeatureFlagsTimer?.cancel();
    Toggly._sync.stopWebSocket();
  }
}
