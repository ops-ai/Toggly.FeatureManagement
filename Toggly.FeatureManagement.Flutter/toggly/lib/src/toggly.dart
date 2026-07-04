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
  static TogglyConfig _config = const TogglyConfig();
  static Map<String, bool> _flagDefaults = {};
  static final _http = HttpService.getInstance.http;
  static final _sync = SyncService.getInstance;

  /// Optional persistence backend supplied via [TogglyConfig.cacheProvider].
  /// When null the SDK is memory-only.
  static TogglyCacheProvider? _cache;

  /// Ephemeral, process-scoped identity used when no explicit identity is
  /// provided. Not persisted — supply a stable identity for offline restart.
  static String? _deviceId;
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

  static List<LocalGate> _localGates = [];
  static Map<String, String> _localGateIndex = {};
  static StreamController<void>? _localGatesChangedController;

  static String? _variantsETag;

  static final Toggly _instance = Toggly._internal();

  Toggly._internal() {
    // Register for lifecycle events only if binding is available
    try {
      WidgetsBinding.instance.addObserver(this);
    } catch (e) {
      // Binding not available (e.g., in tests), skip observer registration
      if (kDebugMode) {
        print(
            'Toggly: WidgetsBinding not available, skipping observer registration');
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

  static void _reportError(
    String message, [
    Object? error,
    StackTrace? stackTrace,
  ]) {
    _lastError = message;
    Toggly._config.onError?.call(message, error, stackTrace);
    if (kDebugMode) {
      print(error == null ? message : '$message: $error');
      if (stackTrace != null) {
        print('Stack trace: $stackTrace');
      }
    }
  }

  /// Stream of current feature flags. Widgets can subscribe to rebuild when
  /// refreshes, cache writes, or local gate changes affect evaluations.
  static Stream<Map<String, bool>> get featureFlagsStream {
    final subject = _featureFlagsSubject;
    if (subject == null) {
      return Stream<Map<String, bool>>.value(featureFlagsSnapshot);
    }

    return subject.stream;
  }

  /// Synchronous snapshot used by widgets before the first stream emission.
  static Map<String, bool> get featureFlagsSnapshot {
    final subject = _featureFlagsSubject;
    if (subject != null && subject.hasValue) {
      return Map<String, bool>.from(subject.value);
    }

    if (_inMemoryFlags != null) {
      return Map<String, bool>.from(_inMemoryFlags!);
    }

    return Map<String, bool>.from(Toggly._flagDefaults);
  }

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
    Toggly._flagDefaults = Map<String, bool>.from(flagDefaults ?? {});
    Toggly._useSignedDefinitions = useSignedDefinitions;

    // Create new subject if needed
    _featureFlagsSubject?.close();
    _featureFlagsSubject =
        BehaviorSubject<Map<String, bool>>.seeded(Toggly._flagDefaults);

    Toggly._appKey = appKey;
    Toggly._environment = environment ?? 'Production';
    Toggly._config = config;
    Toggly._cache = config.cacheProvider;

    _localGatesChangedController?.close();
    _localGatesChangedController = StreamController<void>.broadcast();
    if (config.localGates != null) {
      setLocalGates(config.localGates!);
    } else {
      _localGates = [];
      _localGateIndex = {};
    }

    // Use the provided identity, or fall back to an ephemeral in-memory
    // device id. The fallback is not persisted: stable targeting and offline
    // restart require the app to pass an explicit [identity].
    if (identity != null) {
      Toggly._identity = identity;
    } else {
      Toggly._identity = (Toggly._deviceId ??= _uuid.v4());
    }
    await checkAndClearFeatureFlagsCache();
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
      // Fall back to the ephemeral in-memory device id (not persisted).
      final deviceId = (Toggly._deviceId ??= _uuid.v4());
      if (Toggly._identity != deviceId) {
        await clearFeatureFlagsCache();
      }
      Toggly._identity = deviceId;
    }
    return await Toggly.refresh();
  }

  /// Returns a [Future] with the cached feature flags values.
  static Future<Map<String, bool>> get cachedFeatureFlags async {
    try {
      // Return in-memory flags if available.
      if (_inMemoryFlags != null) {
        return _inMemoryFlags!;
      }

      // No persistence backend — fall back to defaults.
      final cache = await Toggly._cache?.readFlags(Toggly._identity);

      if (cache == null) {
        // If no cache exists, return defaults
        return Map<String, bool>.from(Toggly._flagDefaults);
      }

      final TogglyFeatureFlagsCache flagsCache = cache;

      if (flagsCache.identity != Toggly._identity) {
        _reportError(
          'Cached feature flags identity mismatch',
          Exception('Cached identity does not match current identity'),
          StackTrace.current,
        );
        await clearFeatureFlagsCache();
        return Map<String, bool>.from(Toggly._flagDefaults);
      }

      final parsedFlags =
          Map<String, bool>.from(jsonDecode(flagsCache.flags));

      // Check if the cache is signed and if the timestamp and signature are present
      if (Toggly._useSignedDefinitions) {
        if (flagsCache.timestamp == null ||
            flagsCache.signature == null ||
            flagsCache.keyId == null) {
          _reportError(
            'Cached feature flags missing signature metadata',
            Exception(
                'Timestamp, signature and keyId are required for signed definitions'),
            StackTrace.current,
          );
          await clearFeatureFlagsCache();
          return Map<String, bool>.from(Toggly._flagDefaults);
        }

        // Validate the signature
        try {
          final isValid = await _verifySignature(
              flagsCache.flags,
              flagsCache.signature!,
              flagsCache.timestamp!,
              true,
              flagsCache.keyId!);

          if (!isValid) {
            _reportError(
              'Signature verification failed',
              Exception('Invalid signature'),
              StackTrace.current,
            );
          }
        } catch (_) {
          // Cached definitions were previously accepted when written. If
          // offline validation cannot be performed now because of transient
          // JWK/signature issues, keep the last-known-good cached flags.
        }
      }

      _inMemoryFlags = parsedFlags;
      _featureFlagsSubject?.add(Map<String, bool>.from(_inMemoryFlags!));
      return _inMemoryFlags!;
    } catch (e, stackTrace) {
      _reportError('Error fetching cached feature flags', e, stackTrace);
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
    _featureFlagsSubject?.add(Map<String, bool>.from(_inMemoryFlags!));

    if (Toggly._useSignedDefinitions) {
      if (timestamp == null || signature == null || keyId == null) {
        throw Exception(
            'Timestamp, signature and keyId are required for signed definitions');
      }
    }

    // Mirror through to the persistence backend, when configured.
    await Toggly._cache?.writeFlags(TogglyFeatureFlagsCache(
      identity: Toggly._identity,
      flags: featureFlags,
      timestamp: timestamp,
      signature: signature,
      keyId: keyId,
    ));
  }

  /// Clears the feature flags cache.
  static Future clearFeatureFlagsCache() async {
    _inMemoryFlags = null;
    _inMemoryVariantDefs = null;
    _featureFlagsSubject?.add(Map<String, bool>.from(Toggly._flagDefaults));
    _eTag = null;
    _variantsETag = null;

    // ETags are memory-only; clear persisted flags/variants for this identity.
    await Toggly._cache?.deleteFlags(Toggly._identity);
    await Toggly._cache?.deleteVariants(Toggly._identity);
  }

  static Future checkAndClearFeatureFlagsCache() async {
    final provider = Toggly._cache;
    if (provider == null) {
      return;
    }

    final flagsCache = await provider.readFlags(Toggly._identity);
    if (flagsCache == null) {
      return;
    }

    if (Toggly._identity != flagsCache.identity) {
      await clearFeatureFlagsCache();
      return;
    }

    final variantsCache = await provider.readVariants(Toggly._identity);
    if (variantsCache != null && Toggly._identity != variantsCache.identity) {
      await clearVariantCache();
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
        if (_eTag != null) {
          headers['If-None-Match'] = _eTag!;
        }
      }

      final queryParameters = <String, dynamic>{
        'u': Toggly._identity,
      };

      final response = await _http.get(
        '${Toggly._config.baseURI}/evaluated-signed/${Toggly._appKey}/${Toggly._environment}',
        queryParameters: queryParameters,
        options: Options(headers: headers),
      );

      if (kDebugMode) {
        print('Raw response: ${response.data}');
      }

      Map<String, bool> flags;

      if (Toggly._useSignedDefinitions) {
        // Parse the response
        final signedResponse = Map<String, dynamic>.from(response.data);
        flags = Map<String, bool>.from(signedResponse['defs'] ??
            signedResponse['data'] ??
            <String, dynamic>{});
        String signature = signedResponse['signature'];
        int timestamp = signedResponse['timestamp'];
        String keyId = signedResponse['kid'];

        // Check existing cache timestamp (anti-rollback) from the provider.
        final existing = await Toggly._cache?.readFlags(Toggly._identity);
        if (existing != null &&
            existing.timestamp != null &&
            timestamp <= existing.timestamp!) {
          _reportError(
            'New definitions timestamp must be greater than existing timestamp',
            Exception(
                'New definitions timestamp must be greater than existing timestamp'),
            StackTrace.current,
          );
          await clearFeatureFlagsCache();
          return TogglyLoadFeatureFlagsResponse.error;
        }

        try {
          final flagsPayload = signedResponse['defs'] ?? signedResponse['data'];
          if (Toggly._config.verifySignatures) {
            final isValid = await _verifySignature(
                jsonEncode(flagsPayload), signature, timestamp, false, keyId);

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
          _reportError('Signature verification failed', e, stack);
          await clearFeatureFlagsCache();
          throw Exception('Signature verification failed');
        }

        // Store new ETag if present
        String? newEtag = response.headers['etag']?.first;
        if (newEtag != null) {
          _eTag = newEtag;
        }
      } else {
        _lastChecked = DateTime.now();
        _lastSynced = DateTime.now();
        final payload = Map<String, dynamic>.from(response.data);
        flags = Map<String, bool>.from(payload['defs'] ?? payload);
        Toggly.cacheFeatureFlags(
            featureFlags: jsonEncode(payload['defs'] ?? payload));

        // Store new ETag if present
        String? newEtag = response.headers['etag']?.first;
        if (newEtag != null) {
          _eTag = newEtag;
        }
      }

      // Cache flags on successful response
      Toggly._featureFlagsSubject?.add(flags);

      if (kDebugMode) {
        print('Toggly.fetchFeatureFlags - ${jsonEncode(flags)}');
      }

      return TogglyLoadFeatureFlagsResponse.fetched;
    } catch (e, stackTrace) {
      if (e is DioException && e.response?.statusCode == 304) {
        _lastChecked = DateTime.now();
        // Not modified, use cached version
        var cached = await cachedFeatureFlags;
        Toggly._featureFlagsSubject?.add(cached);
        return TogglyLoadFeatureFlagsResponse.cached;
      } else if (e is DioException && e.response?.statusCode == 403) {
        _reportError('Error fetching feature flags', e, stackTrace);
        // Clear cached data on 403 responses
        await clearFeatureFlagsCache();
        _inMemoryJwks = null;
        await Toggly._cache?.deleteJwks();

        return TogglyLoadFeatureFlagsResponse.error;
      }

      if (e.toString().contains('Signature verification failed')) {
        return TogglyLoadFeatureFlagsResponse.error;
      }

      _reportError('Error fetching feature flags', e, stackTrace);
      final cached = await cachedFeatureFlags;
      Toggly._featureFlagsSubject?.add(cached);
      return cached.isEmpty
          ? TogglyLoadFeatureFlagsResponse.defaults
          : TogglyLoadFeatureFlagsResponse.cached;
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
      if (_variantsETag != null) {
        headers['If-None-Match'] = _variantsETag!;
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
      final defsPayload = signedResponse['defs'] ??
          signedResponse['data'] ??
          <String, dynamic>{};
      final defs = defsPayload is Map
          ? Map<String, dynamic>.from(defsPayload)
          : <String, dynamic>{};

      final signature = signedResponse['signature'] as String?;
      final timestamp = signedResponse['timestamp'] as int?;
      final keyId = signedResponse['kid'] as String?;
      if (signature == null || timestamp == null || keyId == null) {
        throw Exception('Variants response missing signature metadata');
      }

      final existingVariants = await Toggly._cache?.readVariants(
        Toggly._identity,
      );
      if (existingVariants != null &&
          existingVariants.timestamp != null &&
          timestamp <= existingVariants.timestamp!) {
        throw Exception(
            'New variants timestamp must be greater than existing timestamp');
      }

      final payloadForSign =
          jsonEncode(defsPayload is Map ? defsPayload : defs);
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
        _inMemoryJwks = null;
        await Toggly._cache?.deleteJwks();
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

    await Toggly._cache?.writeVariants(TogglyVariantsCache(
      identity: Toggly._identity,
      variants: variantsJson,
      timestamp: timestamp,
      signature: signature,
      keyId: keyId,
    ));
  }

  /// Drops variant cache from memory and secure storage for the current identity.
  static Future<void> clearVariantCache() async {
    _inMemoryVariantDefs = null;
    _variantsETag = null;

    await Toggly._cache?.deleteVariants(Toggly._identity);
  }

  static Future<Map<String, dynamic>>
      _readVerifiedVariantDefsFromCache() async {
    try {
      final vc = await Toggly._cache?.readVariants(Toggly._identity);
      if (vc == null) {
        return {};
      }
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
    } catch (e, stackTrace) {
      _reportError('Error loading cached variant definitions', e, stackTrace);
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
    } catch (e, stackTrace) {
      _reportError('Error loading cached variant definitions', e, stackTrace);
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
    final result = _variantResultFromDef(raw);
    if (!applyLocalGate(
      result.enabled,
      featureKey,
      _localGates,
      _localGateIndex,
    )) {
      return const VariantResult(
        enabled: false,
        name: null,
        configurationValue: null,
      );
    }
    return result;
  }

  /// Register device-local gates (read-time AND on worker booleans).
  static void setLocalGates(List<LocalGate> gates) {
    _localGates = List<LocalGate>.from(gates);
    _localGateIndex = buildFlagGateIndex(_localGates);
  }

  /// Notify listeners that local gate state changed (no network fetch).
  static void notifyLocalGatesChanged() {
    _localGatesChangedController?.add(null);
    _featureFlagsSubject?.add(featureFlagsSnapshot);
  }

  /// Stream that fires when [notifyLocalGatesChanged] is called.
  static Stream<void> get onLocalGatesChanged =>
      _localGatesChangedController?.stream ?? const Stream.empty();

  static bool _getEffectiveFlagValue(Map<String, bool> flags, String flagKey) {
    final remote = flags[flagKey] ?? false;
    return applyLocalGate(remote, flagKey, _localGates, _localGateIndex);
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

      // Try to get cached JWKs from the persistence backend.
      var cachedJwks = await Toggly._cache?.readJwks();
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
          _reportError(
            'Invalid cached JWKs',
            Exception('Invalid cached JWKs'),
            StackTrace.current,
          );
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
        _reportError(
          'Invalid JWKs received from server',
          Exception('Invalid JWKs received from server'),
          StackTrace.current,
        );
        throw Exception('Invalid JWKs received from server');
      }

      jwksData['_expiresAt'] =
          DateTime.now().add(const Duration(days: 30)).millisecondsSinceEpoch;

      // Cache in memory
      _inMemoryJwks = jwksData;

      // Cache through the persistence backend, when configured.
      await Toggly._cache?.writeJwks(jsonEncode(jwksData));

      if (kDebugMode) {
        print('Fetched and cached new JWKs');
      }

      return jwksData;
    } catch (e, stackTrace) {
      _reportError('Error fetching JWKs', e, stackTrace);
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
      _reportError(
        'Key ID not in trusted whitelist',
        Exception('Key ID not in trusted whitelist'),
        StackTrace.current,
      );
      throw Exception('Key ID not in trusted whitelist');
    }

    // Get JWKs
    final jwksData =
        await _fetchAndCacheJwks(ignoreExpiration: allowOfflineValidation);
    if (jwksData == null) {
      _reportError(
        'Failed to fetch JWKs',
        Exception('Failed to fetch JWKs'),
        StackTrace.current,
      );
      throw Exception('Failed to fetch JWKs');
    }

    final jwksList = List<Map<String, dynamic>>.from(jwksData['keys']);

    // Find matching key
    final matchingKeys = jwksList.where((jwk) => jwk['kid'] == keyId);
    if (matchingKeys.isEmpty) {
      _reportError(
        'No matching key found for ID: $keyId',
        Exception('No matching key found for ID: $keyId'),
        StackTrace.current,
      );
      throw Exception('No matching key found for ID: $keyId');
    }
    final jwk = matchingKeys.first;

    // Create data string to verify and hash it with SHA-256
    final dataToVerify = '$flags|$timestamp';
    final messageHash = sha256.convert(utf8.encode(dataToVerify)).bytes;

    try {
      if (jwk['x'] == null || jwk['y'] == null) {
        _reportError(
          'Invalid JWK: missing x or y coordinates',
          Exception('Invalid JWK: missing x or y coordinates'),
          StackTrace.current,
        );
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
      _reportError('Signature verification failed', e, stack);
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

  /// Synchronously evaluates a gate against a known flag map.
  static bool evaluateFeatureGateSync(
    List<String> gate, {
    required Map<String, bool> flags,
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) {
    return _evaluateFeatureGate(
      flags,
      gate: gate,
      requirement: requirement,
      negate: negate,
    );
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
      final isEnabled = _getEffectiveFlagValue(flags, gate.first);
      return negate ? !isEnabled : isEnabled;
    }

    // Fast path for ALL requirement
    if (requirement == FeatureRequirement.all) {
      for (final featureKey in gate) {
        if (!_getEffectiveFlagValue(flags, featureKey)) {
          return negate;
        }
      }
      return !negate;
    }

    // ANY requirement
    for (final featureKey in gate) {
      if (_getEffectiveFlagValue(flags, featureKey)) {
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
    _localGatesChangedController?.close();
    _localGatesChangedController = null;

    // Remove lifecycle observer only if binding is available
    try {
      WidgetsBinding.instance.removeObserver(_instance);
    } catch (e) {
      // Binding not available (e.g., in tests), skip observer removal
      if (kDebugMode) {
        print(
            'Toggly: WidgetsBinding not available, skipping observer removal');
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
              print('Toggly: Skipping poll refresh — WebSocket is connected');
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
