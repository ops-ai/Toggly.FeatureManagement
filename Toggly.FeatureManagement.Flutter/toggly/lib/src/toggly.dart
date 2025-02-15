import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:ecdsa/ecdsa.dart';
import 'package:elliptic/elliptic.dart';
import 'package:crypto/crypto.dart';

import 'package:feature_flags_toggly/feature_flags_toggly.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import 'package:rxdart/rxdart.dart';

/// Static class providing feature flags support.
///
/// Allows enabling and disabling of features easily. Can be used with or without Toggly.io.
class Toggly {
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

  // Add new static field for in-memory cache
  static Map<String, bool>? _inMemoryFlags;

  // Add new static field for in-memory JWKs cache
  static Map<String, dynamic>? _inMemoryJwks;

  static final Toggly _instance = Toggly._internal();

  Toggly._internal();

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

    Toggly._config = config;
    Toggly._flagDefaults = flagDefaults ?? {};
    Toggly._useSignedDefinitions = useSignedDefinitions;
    if (kDebugMode) {
      print('Toggly.init');
    }

    Toggly.startTimers();

    return await Toggly.refresh();
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
    if (kDebugMode) {
      print('Toggly.refresh');
    }

    // In case there is no API key provided, only the flag defaults shall be used
    if (Toggly._appKey == null) {
      Toggly._featureFlagsSubject?.add(Toggly._flagDefaults);

      return TogglyInitResponse(
        status: TogglyLoadFeatureFlagsResponse.defaults,
      );
    }

    try {
      // Try to fetch flags from the API
      await Toggly.fetchFeatureFlags();

      return TogglyInitResponse(
        status: TogglyLoadFeatureFlagsResponse.fetched,
      );
    } catch (e) {
      if (e is DioError && e.response?.statusCode == 304) {
        // Not modified, use cached version
        var cached = await cachedFeatureFlags;
        if (cached != null) {
          Toggly._featureFlagsSubject?.add(cached);
          return TogglyInitResponse(
            status: TogglyLoadFeatureFlagsResponse.cached,
          );
        }
      } else if (e is DioError && e.response?.statusCode == 403) {
        // Clear cached data on 403 responses
        await clearFeatureFlagsCache();
        await _storage.delete(key: SecureStorageKeys.jwks.toString());
      }
      var cached = await cachedFeatureFlags;
      if (cached != null) {
        Toggly._featureFlagsSubject?.add(cached);
        return TogglyInitResponse(
          status: TogglyLoadFeatureFlagsResponse.cached,
        );
      }

      Toggly._featureFlagsSubject?.add(Toggly._flagDefaults);
      return TogglyInitResponse(
        status: TogglyLoadFeatureFlagsResponse.defaults,
      );
    }
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

  /// Returns a [Future] with the current feature flags values.
  static Future<Map<String, bool>> get featureFlags async {
    try {
      if (Toggly._appKey == null) {
        throw TogglyMissingAppKeyException();
      }

      return await Toggly.cachedFeatureFlags ?? await fetchFeatureFlags();
    } catch (_) {
      return Toggly._flagDefaults;
    }
  }

  /// Returns a [Future] with the cached feature flags values.
  static Future<Map<String, bool>?> get cachedFeatureFlags async {
    try {
      // Return in-memory flags if available
      if (_inMemoryFlags != null) {
        return _inMemoryFlags;
      }

      String? cache = await _storage.get(
          key: SecureStorageKeys.featureFlagsCache.toString());

      if (cache == null) {
        return null;
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
          throw Exception('Invalid signature');
        }

        if (flagsCache.identity == Toggly._identity) {
          _inMemoryFlags = Map<String, bool>.from(jsonDecode(flagsCache.flags));
          return _inMemoryFlags;
        }
        return null;
      }

      if (flagsCache.identity == Toggly._identity) {
        _inMemoryFlags = Map<String, bool>.from(jsonDecode(flagsCache.flags));
        return _inMemoryFlags;
      }
      return null;
    } catch (_) {
      await clearFeatureFlagsCache();
      return null;
    }
  }

  /// Stores the provided [featureFlags] into cache.
  static void cacheFeatureFlags({
    required String featureFlags,
    int? timestamp,
    String? signature,
    String? keyId,
  }) async {
    // Update in-memory cache
    _inMemoryFlags = Map<String, bool>.from(jsonDecode(featureFlags));

    if (Toggly._useSignedDefinitions) {
      if (timestamp == null || signature == null || keyId == null) {
        throw Exception(
            'Timestamp, signature and keyId are required for signed definitions');
      }
    }

    await _storage.set(
      key: SecureStorageKeys.featureFlagsCache.toString(),
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
    await _storage.delete(
      key: SecureStorageKeys.featureFlagsCache.toString(),
    );
    await _storage.delete(key: SecureStorageKeys.etag.toString());
  }

  /// Returns the feature flags default values provided during [init]
  static Map<String, bool> get featureFlagDefaults {
    return Toggly._flagDefaults;
  }

  /// Retrieves feature flags values from the Toggly.io Client API.
  static Future<Map<String, bool>> fetchFeatureFlags() async {
    try {
      // Prepare headers
      Map<String, dynamic> headers = {};

      if (Toggly._useSignedDefinitions) {
        String? etag =
            await _storage.get(key: SecureStorageKeys.etag.toString());
        if (etag != null) {
          headers['If-None-Match'] = etag;
        }
      }

      final response = await _http.get(
        '${Toggly._config.baseURI}/${Toggly._appKey}-${Toggly._environment}/${Toggly._useSignedDefinitions ? 'signed-defs' : 'defs'}?u=${Toggly._identity}',
        queryParameters: {},
        options: Options(headers: headers),
      );

      if (kDebugMode) {
        print('Raw response: ${response.data}');
      }

      Map<String, bool> flags;

      if (Toggly._useSignedDefinitions) {
        // Store new ETag if present
        String? newEtag = response.headers['etag']?.first;
        if (newEtag != null) {
          await _storage.set(
            key: SecureStorageKeys.etag.toString(),
            value: newEtag,
          );
        }

        // Parse the response
        final signedResponse = Map<String, dynamic>.from(response.data);
        flags = Map<String, bool>.from(signedResponse['data']);
        String signature = signedResponse['signature'];
        int timestamp = signedResponse['timestamp'];
        String keyId = signedResponse['kid'];

        // Check existing cache timestamp
        String? existingCache = await _storage.get(
            key: SecureStorageKeys.featureFlagsCache.toString());

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
          final isValid = await _verifySignature(
              jsonEncode(signedResponse['data']),
              signature,
              timestamp,
              false,
              keyId);

          if (!isValid) {
            throw Exception('Invalid signature');
          } else {
            if (kDebugMode) {
              print('Signature verification successful');
            }
            Toggly.cacheFeatureFlags(
                featureFlags: jsonEncode(signedResponse['data']),
                timestamp: timestamp,
                signature: signature,
                keyId: keyId);
          }
        } catch (e, stack) {
          if (kDebugMode) {
            print('Signature verification failed: $e');
            print('Stack trace: $stack');
          }
          throw Exception('Signature verification failed');
        }
      } else {
        flags = Map<String, bool>.from(response.data);
        Toggly.cacheFeatureFlags(featureFlags: jsonEncode(response.data));
      }

      // Cache flags on successful response
      Toggly._featureFlagsSubject?.add(flags);

      if (kDebugMode) {
        print('Toggly.fetchFeatureFlags - ${jsonEncode(flags)}');
      }

      return flags;
    } catch (e) {
      if (e is DioError && e.response?.statusCode == 304) {
        // Not modified, use cached version
        var cached = await cachedFeatureFlags;
        if (cached != null) {
          Toggly._featureFlagsSubject?.add(cached);
          return cached;
        }
      } else if (e is DioError && e.response?.statusCode == 403) {
        // Clear cached data on 403 responses
        await clearFeatureFlagsCache();
        await _storage.delete(key: SecureStorageKeys.jwks.toString());
      }
      throw Exception('Failed to fetch feature flags from the API: $e');
    }
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
          return false;
        }
      }
      return true;
    } catch (e) {
      if (kDebugMode) {
        print('Error validating JWKs: $e');
      }
      return false;
    }
  }

  /// Verifies the signature of feature flags data
  static Future<bool> _verifySignature(String flags, String signature,
      int timestamp, bool allowOfflineValidation, String keyId) async {
    // Check if keyId is in whitelist if one is provided
    if (Toggly._config.trustedKeyIds != null &&
        !Toggly._config.trustedKeyIds!.contains(keyId)) {
      throw Exception('Key ID not in trusted whitelist');
    }

    // Get JWKs
    final jwksData =
        await _fetchAndCacheJwks(ignoreExpiration: allowOfflineValidation);
    if (jwksData == null) {
      throw Exception('Failed to fetch JWKs');
    }

    final jwksList = List<Map<String, dynamic>>.from(jwksData['keys']);

    // Find matching key
    final matchingKeys = jwksList.where((jwk) => jwk['kid'] == keyId);
    if (matchingKeys.isEmpty) {
      throw Exception('No matching key found for ID: $keyId');
    }
    final jwk = matchingKeys.first;

    // Create data string to verify and hash it with SHA-256
    final dataToVerify = '$flags|$timestamp';
    final messageHash = sha256.convert(utf8.encode(dataToVerify)).bytes;

    try {
      if (jwk['x'] == null || jwk['y'] == null) {
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
      throw Exception('Signature verification failed');
    }
  }

  static Future<bool> evaluateFeatureGate(
    List<String> gate, {
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) async {
    // Fast path: use in-memory flags if available
    if (_inMemoryFlags != null) {
      return _evaluateFeatureGate(_inMemoryFlags!,
          gate: gate, requirement: requirement, negate: negate);
    }

    // Fallback to stream-based evaluation
    return Toggly._featureFlagsSubject!.whereNotNull().switchMap(
      (flags) async* {
        yield Toggly._evaluateFeatureGate(flags,
            gate: gate, requirement: requirement, negate: negate);
      },
    ).first;
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
    _inMemoryJwks = null; // Clear JWKs cache
    _featureFlagsSubject?.close();
    _featureFlagsSubject = null;
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

          await Toggly.refresh();
        },
      );
    }
  }

  /// Cancels the registered timers.
  static void cancelTimers() {
    Toggly._sync.refreshFeatureFlagsTimer?.cancel();
  }
}
