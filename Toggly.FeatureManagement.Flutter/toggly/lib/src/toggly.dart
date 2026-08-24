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

import 'entity_gate.dart' as entity_gate;

/// Static class providing feature flags support.
///
/// Allows enabling and disabling of features easily. Can be used with or without Toggly.io.
class Toggly with WidgetsBindingObserver {
  static const Uuid _uuid = Uuid();
  static late String? _appKey;
  static String _environment = 'Production';
  static bool _useSignedDefinitions = false;
  static late String _identity;
  static List<String> _groups = [];
  static Map<String, String> _claims = {};
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
  static String? _definitionsRevision;
  static String? _lastError;
  // Add new static field for in-memory cache
  static Map<String, bool>? _inMemoryFlags;
  static Map<String, dynamic>? _inMemoryDefinitions;

  /// True until at least one successful HTTP definitions fetch sets [_lastSynced].
  static bool get _needsInitialHttpSync => _lastSynced == null;

  // Add new static field for in-memory JWKs cache
  static Map<String, dynamic>? _inMemoryJwks;

  /// Parsed `defs` map from the last successful variants response (feature key → payload).
  static Map<String, dynamic>? _inMemoryVariantDefs;

  static List<LocalGate> _localGates = [];
  static Map<String, String> _localGateIndex = {};
  static StreamController<void>? _localGatesChangedController;

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
      'appKey': _sanitizeAppKey(_appKey),
      'environment': _environment,
      'useSignedDefinitions': _useSignedDefinitions.toString(),
      'isAppInForeground': _checkAppVisibility().toString(),
      'refreshInterval': Toggly._config.featureFlagsRefreshInterval.toString(),
      'jwksCacheDuration': Toggly._config.jwksCacheDuration.toString(),
      'syncServiceRunning':
          Toggly._sync.refreshFeatureFlagsTimer != null ? 'Yes' : 'No',
      'lastChecked': _lastChecked?.toString(),
      'lastSynced': _lastSynced?.toString(),
      'definitionsRevision': _definitionsRevision,
      'lastError': _lastError,
      'enableVariants': Toggly._config.enableVariants.toString(),
    };
  }

  /// Masks app keys for debug surfaces (last 6 characters when long enough).
  static String _sanitizeAppKey(String? appKey) {
    if (appKey == null || appKey.isEmpty) {
      return '***';
    }
    return appKey.length > 6
        ? '***${appKey.substring(appKey.length - 6)}'
        : '***';
  }

  static Duration get _jwksCacheDuration {
    final configured = Toggly._config.jwksCacheDuration;
    const minDuration = Duration(minutes: 1);
    return configured < minDuration ? minDuration : configured;
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
    bool useSignedDefinitions = true,
    TogglyConfig config = const TogglyConfig(),
    Map<String, bool>? flagDefaults,
    List<String>? groups,
    Map<String, String>? claims,
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
    final cacheProvider = config.cacheProvider;
    final maxCacheKeys = config.maxCacheKeys;
    if (cacheProvider != null && maxCacheKeys != null && maxCacheKeys > 0) {
      Toggly._cache = LruTogglyCacheProvider(
        cacheProvider,
        maxCacheKeys: maxCacheKeys,
      );
    } else {
      Toggly._cache = cacheProvider;
    }

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
    Toggly._groups = groups != null ? List<String>.from(groups) : [];
    Toggly._claims = claims != null ? Map<String, String>.from(claims) : {};
    await checkAndClearFeatureFlagsCache();
    await _loadCachedDefinitionsRevision();
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
    if (Toggly._appKey != null && _definitionsRevision == null) {
      await _loadCachedDefinitionsRevision();
    }

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
  ///
  /// When the identity changes, in-memory evaluation state is cleared and
  /// [refresh] runs for the new context. Persisted flags, variants, and
  /// revisions for other users are kept so switching back does not require a
  /// full re-fetch. The feature-flag stream may briefly emit [flagDefaults]
  /// until [refresh] completes.
  static Future<TogglyInitResponse> setIdentity(String? identity) async {
    final identityChanged = identity != null
        ? Toggly._identity != identity
        : Toggly._identity != (Toggly._deviceId ??= _uuid.v4());

    if (identity != null) {
      Toggly._identity = identity;
    } else {
      Toggly._identity = (Toggly._deviceId ??= _uuid.v4());
    }

    if (identityChanged) {
      _clearInMemoryEvaluationState();
      return Toggly.refresh();
    }

    return TogglyInitResponse(status: TogglyLoadFeatureFlagsResponse.cached);
  }

  /// Sets evaluation context for targeting (identity, groups, claims).
  ///
  /// Same persistence rules as [setIdentity]: only in-memory state is cleared
  /// on context change; other users' persisted cache entries are retained.
  static Future<TogglyInitResponse> setContext({
    String? identity,
    List<String>? groups,
    Map<String, String>? claims,
  }) async {
    var shouldRefresh = false;

    if (identity != null && Toggly._identity != identity) {
      Toggly._identity = identity;
      shouldRefresh = true;
    }

    if (groups != null) {
      Toggly._groups = List<String>.from(groups);
      shouldRefresh = true;
    }

    if (claims != null) {
      Toggly._claims = Map<String, String>.from(claims);
      shouldRefresh = true;
    }

    if (shouldRefresh) {
      _clearInMemoryEvaluationState();
      return Toggly.refresh();
    }

    return TogglyInitResponse(status: TogglyLoadFeatureFlagsResponse.cached);
  }

  /// Drops in-memory evaluation state for the current context without deleting
  /// persisted flags, variants, or revisions (supports multi-user switch-back).
  static void _clearInMemoryEvaluationState() {
    _inMemoryFlags = null;
    _inMemoryDefinitions = null;
    _inMemoryVariantDefs = null;
    _definitionsRevision = null;
    _lastSynced = null;
    _lastChecked = null;
    _featureFlagsSubject?.add(Map<String, bool>.from(Toggly._flagDefaults));
  }

  static String get _contextCacheKey {
    final parts = <String>['u:${Toggly._identity}'];
    if (Toggly._groups.isNotEmpty) {
      final sorted = List<String>.from(Toggly._groups)..sort();
      parts.add('g:${sorted.join(',')}');
    }
    if (Toggly._claims.isNotEmpty) {
      final entries = Toggly._claims.entries.toList()
        ..sort((a, b) => a.key.compareTo(b.key));
      parts.add('c:${entries.map((e) => '${e.key}=${e.value}').join('&')}');
    }
    return parts.join('|');
  }

  static Map<String, dynamic> _buildEvaluationQueryParameters(
      {required bool variants}) {
    final params = <String, dynamic>{};
    if (variants) {
      params['userId'] = Toggly._identity;
    } else {
      params['u'] = Toggly._identity;
    }
    if (Toggly._groups.isNotEmpty) {
      params['g'] = List<String>.from(Toggly._groups);
    }
    for (final entry in Toggly._claims.entries) {
      params['claim.${entry.key}'] = entry.value;
    }
    return params;
  }

  /// Returns a [Future] with the cached feature flags values.
  static Future<Map<String, bool>> get cachedFeatureFlags async {
    try {
      // Return in-memory flags if available.
      if (_inMemoryFlags != null) {
        return _inMemoryFlags!;
      }

      // No persistence backend — fall back to defaults.
      final cache = await Toggly._cache?.readFlags(Toggly._contextCacheKey);

      if (cache == null) {
        // If no cache exists, return defaults
        return Map<String, bool>.from(Toggly._flagDefaults);
      }

      final TogglyFeatureFlagsCache flagsCache = cache;

      if (flagsCache.identity != Toggly._contextCacheKey) {
        _reportError(
          'Cached feature flags identity mismatch',
          Exception('Cached identity does not match current identity'),
          StackTrace.current,
        );
        await clearFeatureFlagsCache();
        return Map<String, bool>.from(Toggly._flagDefaults);
      }

      final parsed =
          entity_gate.parseEvaluatedDefinitions(jsonDecode(flagsCache.flags));
      final parsedFlags = entity_gate.toBooleanDefinitions(parsed);

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

        // Re-verify persisted flags before trusting them. Invalid signatures
        // fail closed (clear cache). Transient JWKS/network failures keep
        // last-known-good flags for offline restart.
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
            await clearFeatureFlagsCache();
            return Map<String, bool>.from(Toggly._flagDefaults);
          }
        } catch (_) {
          // Cached definitions were previously accepted when written. If
          // offline validation cannot be performed now because of transient
          // JWK issues, keep the last-known-good cached flags.
        }
      }

      _inMemoryDefinitions = parsed;
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
    final parsed =
        entity_gate.parseEvaluatedDefinitions(jsonDecode(featureFlags));
    _inMemoryDefinitions = parsed;
    _inMemoryFlags = entity_gate.toBooleanDefinitions(parsed);
    _featureFlagsSubject?.add(Map<String, bool>.from(_inMemoryFlags!));

    if (Toggly._useSignedDefinitions) {
      if (timestamp == null || signature == null || keyId == null) {
        throw Exception(
            'Timestamp, signature and keyId are required for signed definitions');
      }
    }

    // Mirror through to the persistence backend, when configured.
    await Toggly._cache?.writeFlags(TogglyFeatureFlagsCache(
      identity: Toggly._contextCacheKey,
      flags: featureFlags,
      timestamp: timestamp,
      signature: signature,
      keyId: keyId,
    ));
  }

  /// Clears the feature flags cache for the current evaluation context.
  ///
  /// Drops in-memory state and deletes persisted flags and variants for
  /// [_contextCacheKey]. By default also deletes the persisted definitions
  /// revision (ETag) used for `If-None-Match` and WebSocket `?rev=` sync.
  /// Pass [deletePersistedRevision: false] only when you need to invalidate
  /// flags/variants without discarding the conditional-fetch etag (uncommon).
  static Future clearFeatureFlagsCache(
      {bool deletePersistedRevision = true}) async {
    _clearInMemoryEvaluationState();

    await Toggly._cache?.deleteFlags(Toggly._contextCacheKey);
    await Toggly._cache?.deleteVariants(Toggly._contextCacheKey);
    if (deletePersistedRevision) {
      await _deleteCachedDefinitionsRevision();
    }
  }

  static Future checkAndClearFeatureFlagsCache() async {
    final provider = Toggly._cache;
    if (provider == null) {
      return;
    }

    final flagsCache = await provider.readFlags(Toggly._contextCacheKey);
    if (flagsCache == null) {
      return;
    }

    if (Toggly._contextCacheKey != flagsCache.identity) {
      await clearFeatureFlagsCache();
      return;
    }

    final variantsCache = await provider.readVariants(Toggly._contextCacheKey);
    if (variantsCache != null &&
        Toggly._contextCacheKey != variantsCache.identity) {
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
      final headers = <String, dynamic>{};
      final revision = _definitionsRevision;
      if (revision != null) {
        headers['If-None-Match'] = revision;
      }

      final queryParameters =
          Toggly._buildEvaluationQueryParameters(variants: false);

      final response = await _http.get(
        '${Toggly._config.baseURI}/evaluated-signed/${Toggly._appKey}/${Toggly._environment}',
        queryParameters: queryParameters,
        options: Options(
          headers: headers,
          // Keep the exact response body so signature verification can use the
          // raw `defs` JSON bytes the server signed (never re-serialize).
          responseType: Toggly._useSignedDefinitions
              ? ResponseType.plain
              : ResponseType.json,
        ),
      );

      if (kDebugMode) {
        print('Raw response: ${response.data}');
      }

      Map<String, dynamic> mixed;
      Map<String, bool> flags;

      if (Toggly._useSignedDefinitions) {
        final parsed = _parseSignedDefinitionsResponse(response.data);
        final signedResponse = parsed.envelope;
        final signedDefsJson = parsed.signedDefsJson;
        mixed = entity_gate.parseEvaluatedDefinitions(signedResponse['defs'] ??
            signedResponse['data'] ??
            <String, dynamic>{});
        flags = entity_gate.toBooleanDefinitions(mixed);
        String signature = signedResponse['signature'];
        int timestamp = signedResponse['timestamp'];
        String keyId = signedResponse['kid'];

        // Anti-rollback: reject definitions strictly OLDER than what we have
        // cached (a genuine downgrade attempt). An EQUAL timestamp is the same
        // signed definitions re-served — e.g. a 200 served without an
        // If-None-Match match, or a cold start before the revision/ETag is
        // known — and MUST be accepted. Treating equal timestamps as a
        // rollback (and clearing the cache) destructively resets every flag
        // back to flagDefaults. On a genuine rollback, keep the newer cached
        // flags and re-emit them instead of wiping to defaults.
        final existing =
            await Toggly._cache?.readFlags(Toggly._contextCacheKey);
        if (existing != null &&
            existing.timestamp != null &&
            timestamp < existing.timestamp!) {
          if (kDebugMode) {
            print(
              'Toggly.fetchFeatureFlags — rejected rollback: incoming timestamp '
              '($timestamp) is older than cached (${existing.timestamp}); '
              'keeping cached flags',
            );
          }
          final cached = await cachedFeatureFlags;
          Toggly._featureFlagsSubject?.add(cached);
          return TogglyLoadFeatureFlagsResponse.cached;
        }

        try {
          final flagsPayload = signedResponse['defs'] ?? signedResponse['data'];
          // Prefer the exact server-signed defs JSON; fall back to encode only
          // when interceptors/tests supply an already-decoded Map.
          final defsForSignature = signedDefsJson ?? jsonEncode(flagsPayload);
          final isValid = await _verifySignature(
              defsForSignature, signature, timestamp, false, keyId);

          if (!isValid) {
            throw Exception('Invalid signature');
          }
          if (kDebugMode) {
            print('Signature verification successful');
          }
          _lastChecked = DateTime.now();
          _lastSynced = DateTime.now();
          Toggly.cacheFeatureFlags(
              featureFlags: defsForSignature,
              timestamp: timestamp,
              signature: signature,
              keyId: keyId);
        } catch (e, stack) {
          _reportError('Signature verification failed', e, stack);
          await clearFeatureFlagsCache();
          throw Exception('Signature verification failed');
        }

        _applyDefinitionsRevision(response);
      } else {
        _lastChecked = DateTime.now();
        _lastSynced = DateTime.now();
        final payload = Map<String, dynamic>.from(response.data);
        mixed =
            entity_gate.parseEvaluatedDefinitions(payload['defs'] ?? payload);
        flags = entity_gate.toBooleanDefinitions(mixed);
        Toggly.cacheFeatureFlags(
            featureFlags: jsonEncode(payload['defs'] ?? payload));

        _applyDefinitionsRevision(response);
      }

      // Cache flags on successful response
      Toggly._inMemoryDefinitions = mixed;
      Toggly._inMemoryFlags = flags;
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
      if (_definitionsRevision != null) {
        headers['If-None-Match'] = _definitionsRevision!;
      }

      final response = await _http.get(
        '${Toggly._config.baseURI}/evaluated-variants-signed/${Toggly._appKey}/${Toggly._environment}',
        queryParameters: Toggly._buildEvaluationQueryParameters(variants: true),
        options: Options(
          headers: headers,
          responseType: ResponseType.plain,
        ),
      );

      if (kDebugMode) {
        print('Toggly variants raw response: ${response.data}');
      }

      final parsed = _parseSignedDefinitionsResponse(response.data);
      final signedResponse = parsed.envelope;
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

      // Anti-rollback: only reject variants strictly OLDER than cached. Equal
      // timestamps are the same signed variants re-served and must be accepted.
      // On a genuine rollback keep the newer cached variants instead of
      // discarding them.
      final existingVariants = await Toggly._cache?.readVariants(
        Toggly._contextCacheKey,
      );
      if (existingVariants != null &&
          existingVariants.timestamp != null &&
          timestamp < existingVariants.timestamp!) {
        if (kDebugMode) {
          print('Toggly.fetchEvaluatedVariants — rejected rollback '
              '($timestamp < ${existingVariants.timestamp}); keeping cached');
        }
        _inMemoryVariantDefs = await _readVerifiedVariantDefsFromCache();
        return;
      }

      final payloadForSign = parsed.signedDefsJson ??
          jsonEncode(defsPayload is Map ? defsPayload : defs);
      if (Toggly._useSignedDefinitions) {
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
        variantsJson: payloadForSign,
        timestamp: timestamp,
        signature: signature,
        keyId: keyId,
      );

      _applyDefinitionsRevision(response);

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
      identity: Toggly._contextCacheKey,
      variants: variantsJson,
      timestamp: timestamp,
      signature: signature,
      keyId: keyId,
    ));
  }

  /// Drops variant cache from memory and secure storage for the current identity.
  static Future<void> clearVariantCache() async {
    _inMemoryVariantDefs = null;

    await Toggly._cache?.deleteVariants(Toggly._contextCacheKey);
  }

  static Future<Map<String, dynamic>>
      _readVerifiedVariantDefsFromCache() async {
    try {
      final vc = await Toggly._cache?.readVariants(Toggly._contextCacheKey);
      if (vc == null) {
        return {};
      }
      if (vc.identity != Toggly._contextCacheKey) {
        return {};
      }

      if (Toggly._useSignedDefinitions) {
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
          DateTime.now().add(_jwksCacheDuration).millisecondsSinceEpoch;

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

  /// Parses a signed definitions HTTP body into an envelope map plus the exact
  /// raw `defs`/`data` JSON substring the server signed.
  ///
  /// When [responseData] is already a decoded [Map] (unit-test interceptors),
  /// [signedDefsJson] is null and callers must fall back to `jsonEncode`.
  static _SignedDefinitionsParseResult _parseSignedDefinitionsResponse(
    dynamic responseData,
  ) {
    if (responseData is String) {
      final envelope = Map<String, dynamic>.from(jsonDecode(responseData));
      final signedDefsJson = _extractRawJsonProperty(responseData, 'defs') ??
          _extractRawJsonProperty(responseData, 'data');
      return _SignedDefinitionsParseResult(
        envelope: envelope,
        signedDefsJson: signedDefsJson,
      );
    }
    if (responseData is Map) {
      return _SignedDefinitionsParseResult(
        envelope: Map<String, dynamic>.from(responseData),
        signedDefsJson: null,
      );
    }
    throw Exception('Unexpected signed definitions response type');
  }

  /// Returns the exact JSON text of a **top-level** [property] from [json],
  /// matching System.Text.Json `GetRawText()` / Go's raw `Defs` bytes.
  ///
  /// Nested keys (e.g. `data.defs`) are ignored so unsigned outer fields
  /// cannot be swapped in after verifying nested signed bytes.
  static String? _extractRawJsonProperty(String json, String property) {
    var index = 0;
    var depth = 0;
    var inString = false;
    var escape = false;

    while (index < json.length) {
      final character = json[index];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (character == '\\') {
          escape = true;
        } else if (character == '"') {
          inString = false;
        }
        index++;
        continue;
      }

      if (character == '"') {
        if (depth == 1) {
          final keyEnd = _findJsonStringEnd(json, index);
          if (keyEnd == null) {
            return null;
          }
          final propertyName = json.substring(index + 1, keyEnd);
          var valueStart = keyEnd + 1;
          while (valueStart < json.length &&
              _isJsonWhitespace(json.codeUnitAt(valueStart))) {
            valueStart++;
          }
          if (propertyName == property &&
              valueStart < json.length &&
              json[valueStart] == ':') {
            valueStart++;
            while (valueStart < json.length &&
                _isJsonWhitespace(json.codeUnitAt(valueStart))) {
              valueStart++;
            }
            return _extractJsonValue(json, valueStart);
          }
          index = keyEnd + 1;
          continue;
        }
        inString = true;
        index++;
        continue;
      }

      if (character == '{' || character == '[') {
        depth++;
      } else if (character == '}' || character == ']') {
        depth--;
      }
      index++;
    }

    return null;
  }

  static int? _findJsonStringEnd(String text, int startQuote) {
    var escape = false;
    for (var i = startQuote + 1; i < text.length; i++) {
      final c = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c == '\\') {
        escape = true;
        continue;
      }
      if (c == '"') {
        return i;
      }
    }
    return null;
  }

  static String? _extractJsonValue(String text, int start) {
    if (start >= text.length) {
      return null;
    }

    final first = text[start];
    if (first == '{' || first == '[') {
      var depth = 0;
      var inString = false;
      var escape = false;
      for (var j = start; j < text.length; j++) {
        final c = text[j];
        if (inString) {
          if (escape) {
            escape = false;
          } else if (c == '\\') {
            escape = true;
          } else if (c == '"') {
            inString = false;
          }
          continue;
        }
        if (c == '"') {
          inString = true;
        } else if (c == '{' || c == '[') {
          depth++;
        } else if (c == '}' || c == ']') {
          depth--;
          if (depth == 0) {
            return text.substring(start, j + 1);
          }
        }
      }
      return null;
    }

    if (first == '"') {
      final end = _findJsonStringEnd(text, start);
      return end == null ? null : text.substring(start, end + 1);
    }

    var j = start;
    while (j < text.length) {
      final ch = text[j];
      if (ch == ',' ||
          ch == '}' ||
          ch == ']' ||
          _isJsonWhitespace(ch.codeUnitAt(0))) {
        break;
      }
      j++;
    }
    return text.substring(start, j);
  }

  static bool _isJsonWhitespace(int codeUnit) =>
      codeUnit == 0x20 || // space
      codeUnit == 0x09 || // tab
      codeUnit == 0x0A || // LF
      codeUnit == 0x0D; // CR

  /// Verifies the signature of feature flags data
  static Future<bool> _verifySignature(String flags, String signature,
      int timestamp, bool allowOfflineValidation, String keyId) async {
    if (signature.isEmpty || keyId.isEmpty) {
      _reportError(
        'Signature verification failed',
        Exception('Empty signature or key ID'),
        StackTrace.current,
      );
      throw Exception('Empty signature or key ID');
    }

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

    // Create data string to verify. Match Toggly.Definitions / Web Crypto
    // subtle.sign(ECDSA, SHA-256): pre-hash once, then the ES256 algorithm
    // hashes again — so verifiers must SHA-256 twice (see Go verify.go and
    // .NET ComputeSignedDefinitionsPayloadHash).
    final dataToVerify = '$flags|$timestamp';
    final firstDigest = sha256.convert(utf8.encode(dataToVerify)).bytes;
    final messageHash = sha256.convert(firstDigest).bytes;

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
    Object? context,
    String? kind,
  }) async {
    return _evaluateFeatureGate(await cachedFeatureFlags,
        gate: gate,
        requirement: requirement,
        negate: negate,
        context: context,
        kind: kind);
  }

  static Future<bool> isFeatureOn(
    String key, {
    Object? context,
    String? kind,
  }) {
    return evaluateFeatureGate([key], context: context, kind: kind);
  }

  static void registerContext(String kind, EntityContextMapper mapper) {
    entity_gate.registerContext(kind, mapper);
  }

  /// Synchronously evaluates a gate against a known flag map.
  static bool evaluateFeatureGateSync(
    List<String> gate, {
    required Map<String, bool> flags,
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
    Object? context,
    String? kind,
  }) {
    return _evaluateFeatureGate(
      flags,
      gate: gate,
      requirement: requirement,
      negate: negate,
      context: context,
      kind: kind,
    );
  }

  static bool _evaluateFeatureGate(
    Map<String, bool> flags, {
    required List<String> gate,
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
    Object? context,
    String? kind,
  }) {
    final entity = entity_gate.normalizeEntityContext(context, kind);
    final mixed = _inMemoryDefinitions ??
        {for (final entry in flags.entries) entry.key: entry.value};
    return entity_gate.evaluateStoredFeatureKeys(
      mixed,
      gate,
      requirement == FeatureRequirement.all,
      negate,
      (key) {
        final remote = entity_gate.resolveEvaluatedDefinition(
          mixed[key],
          context: entity,
        );
        return applyLocalGate(remote, key, _localGates, _localGateIndex);
      },
    );
  }

  /// Cancels registered timers and closes the feature flags stream.
  static void dispose() {
    cancelTimers();
    _inMemoryFlags = null;
    _inMemoryDefinitions = null;
    _inMemoryVariantDefs = null;
    _definitionsRevision = null;
    _lastSynced = null;
    _lastChecked = null;
    _lastError = null;
    _inMemoryJwks = null; // Clear JWKs cache
    entity_gate.clearRegisteredContexts();
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

          // When WebSocket is connected or reconnecting, skip polling — live
          // updates are handled by the WebSocket. Polling resumes once the
          // connection drops and reconnect is not in progress.
          // Exception: never skip while we still need an initial HTTP sync;
          // WS connectivity is not a substitute for a successful fetch.
          if ((Toggly._sync.wsConnected || Toggly._sync.wsReconnecting) &&
              !Toggly._needsInitialHttpSync) {
            if (kDebugMode) {
              print(
                'Toggly: Skipping poll refresh — WebSocket active or reconnecting',
              );
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
    Toggly._sync.onSyncMessage =
        ({required bool unchanged, String? etag}) async {
      final previousRevision = _definitionsRevision;

      if (shouldFetchOnSync(
        unchanged: unchanged,
        messageEtag: etag,
        cachedRevision: previousRevision,
        hasSuccessfulSync: !Toggly._needsInitialHttpSync,
      )) {
        Toggly._sync.requestRefresh();
      } else if (kDebugMode) {
        print('Toggly: WebSocket sync unchanged — skipping fetch');
      }

      if (etag != null) {
        await _cacheDefinitionsRevision(etag);
      }
    };

    Toggly._sync.onRefreshRequested = ({required bool forceJwksRefresh}) async {
      if (forceJwksRefresh) {
        _definitionsRevision = null;
        Toggly._sync.updateCachedRevision(null);
        await _deleteCachedDefinitionsRevision();
        _inMemoryJwks = null;
        await Toggly._cache?.deleteJwks();
      }

      if (kDebugMode) {
        print('Toggly: WebSocket triggered refresh');
      }
      await Toggly.refresh();
    };

    Toggly._sync.onDefinitionsRevisionUpdated = (etag) {
      unawaited(_cacheDefinitionsRevision(etag));
    };

    Toggly._sync.onConnected = () {
      if (Toggly._needsInitialHttpSync) {
        if (kDebugMode) {
          print(
            'Toggly: WebSocket connected — forcing initial definitions fetch',
          );
        }
        Toggly._sync.requestRefresh();
      }
    };

    Toggly._sync.startWebSocket(
      baseURI: Toggly._config.baseURI,
      appKey: Toggly._appKey!,
      cachedRevision: _definitionsRevision,
    );
  }

  static TogglyRevisionCacheProvider? get _revisionCache {
    final cache = Toggly._cache;
    return cache is TogglyRevisionCacheProvider ? cache : null;
  }

  static Future<void> _loadCachedDefinitionsRevision() async {
    final appKey = Toggly._appKey;
    if (appKey == null) {
      return;
    }

    final revision = await _revisionCache?.readDefinitionsRevision(
      appKey,
      Toggly._environment,
      Toggly._contextCacheKey,
    );
    if (revision != null && revision.isNotEmpty) {
      _definitionsRevision = revision;
    }
  }

  static Future<void> _cacheDefinitionsRevision(String revision) async {
    final normalized = revision.replaceAll(RegExp(r'^"+|"+$'), '');
    if (normalized.isEmpty) {
      return;
    }

    _definitionsRevision = normalized;
    Toggly._sync.updateCachedRevision(normalized);

    final appKey = Toggly._appKey;
    if (appKey == null) {
      return;
    }

    await _revisionCache?.writeDefinitionsRevision(
      appKey,
      Toggly._environment,
      Toggly._contextCacheKey,
      normalized,
    );
  }

  static Future<void> _deleteCachedDefinitionsRevision() async {
    final appKey = Toggly._appKey;
    if (appKey == null) {
      return;
    }

    await _revisionCache?.deleteDefinitionsRevision(
      appKey,
      Toggly._environment,
      Toggly._contextCacheKey,
    );
  }

  static void _applyDefinitionsRevision(Response<dynamic> response) {
    final revision = _extractDefinitionsRevision(response);
    if (revision != null) {
      unawaited(_cacheDefinitionsRevision(revision));
    }
  }

  static String? _extractDefinitionsRevision(Response<dynamic> response) {
    final custom = response.headers.value(definitionsRevisionHeader) ??
        response.headers.value(definitionsRevisionHeader.toLowerCase());
    if (custom != null && custom.isNotEmpty) {
      return custom;
    }

    final etag = response.headers.value('etag');
    if (etag != null && etag.isNotEmpty) {
      return etag;
    }

    return null;
  }

  /// Cancels the registered timers and stops the WebSocket connection.
  static void cancelTimers() {
    Toggly._sync.refreshFeatureFlagsTimer?.cancel();
    Toggly._sync.stopWebSocket();
  }
}

class _SignedDefinitionsParseResult {
  const _SignedDefinitionsParseResult({
    required this.envelope,
    required this.signedDefsJson,
  });

  final Map<String, dynamic> envelope;
  final String? signedDefsJson;
}
