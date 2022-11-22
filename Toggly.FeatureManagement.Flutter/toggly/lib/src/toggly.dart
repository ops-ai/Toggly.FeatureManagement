import 'dart:async';
import 'dart:convert';

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
  static late String _identity;
  static late TogglyConfig _config;
  static Map<String, bool> _flagDefaults = {};
  static final _http = HttpService.getInstance.http;
  static final _storage = SecureStorageService.getInstance;
  static final _sync = SyncService.getInstance;
  static final _featureFlagsSubject = BehaviorSubject<Map<String, bool>>();

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
    TogglyConfig config = const TogglyConfig(),
    Map<String, bool>? flagDefaults,
  }) async {
    Toggly._appKey = appKey;
    Toggly._environment = environment ?? 'Production';
    Toggly._identity = identity ?? Toggly._uuid.v4();
    Toggly._config = config;
    Toggly._flagDefaults = flagDefaults ?? {};

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
      Toggly._featureFlagsSubject.add(Toggly._flagDefaults);

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
    } catch (_) {
      // Try to load flags from Cache
      var flags = await Toggly.cachedFeatureFlags;
      var status = TogglyLoadFeatureFlagsResponse.cached;

      if (flags == null) {
        // Otherwise use provided default flags
        flags = Toggly._flagDefaults;
        status = TogglyLoadFeatureFlagsResponse.defaults;

        if (kDebugMode) {
          print('Toggly.usedFlagDefaults - ${jsonEncode(flags)}');
        }
      } else {
        if (kDebugMode) {
          print('Toggly.loadedFromCache - ${jsonEncode(flags)}');
        }
      }

      Toggly._featureFlagsSubject.add(flags);

      return TogglyInitResponse(
        status: status,
      );
    }
  }

  /// Sets an unique identifier to the current session. Useful in case of custom
  /// feature rollouts.
  static Future<TogglyInitResponse> setIdentity(String? identity) async {
    Toggly._identity = identity ?? Toggly._uuid.v4();
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
      String? cache = await _storage.get(
          key: SecureStorageKeys.featureFlagsCache.toString());

      TogglyFeatureFlagsCache flagsCache = TogglyFeatureFlagsCache.fromJson(
        jsonDecode(cache!),
      );

      return flagsCache.identity == Toggly._identity ? flagsCache.flags : null;
    } catch (_) {
      return null;
    }
  }

  /// Stores the provided [featureFlags] into cache.
  static void cacheFeatureFlags({
    required Map<String, bool> featureFlags,
  }) async {
    await _storage.set(
      key: SecureStorageKeys.featureFlagsCache.toString(),
      value: jsonEncode(TogglyFeatureFlagsCache(
        identity: Toggly._identity,
        flags: featureFlags,
      )),
    );
  }

  /// Clears the feature flags cache.
  static void clearFeatureFlagsCache() async {
    await _storage.delete(
      key: SecureStorageKeys.featureFlagsCache.toString(),
    );
  }

  /// Returns the feature flags default values provided during [init]
  static Map<String, bool> get featureFlagDefaults {
    return Toggly._flagDefaults;
  }

  /// Retrieves feature flags values from the Toggly.io Client API.
  static Future<Map<String, bool>> fetchFeatureFlags() async {
    try {
      final response = await _http.get(
        '${Toggly._config.baseURI}/${Toggly._appKey}-${Toggly._environment}/defs?u=${Toggly._identity}',
        queryParameters: {},
      );

      Map<String, bool> flags = Map<String, bool>.from(response.data);

      // Cache flags on successful response
      Toggly.cacheFeatureFlags(featureFlags: flags);

      Toggly._featureFlagsSubject.add(flags);

      if (kDebugMode) {
        print('Toggly.fetchFeatureFlags - ${jsonEncode(flags)}');
      }

      return flags;
    } catch (_) {
      throw Exception('Failed to fetch feature flags from the API.');
    }
  }

  static bool _evaluateFeatureGate(
    Map<String, bool> flags, {
    required List<String> gate,
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) {
    late bool isEnabled;

    if (requirement == FeatureRequirement.any) {
      isEnabled = gate.fold<bool>(false, (isEnabled, featureKey) {
        return isEnabled ||
            (flags.containsKey(featureKey) && flags[featureKey] == true);
      });
    } else {
      isEnabled = gate.fold<bool>(true, (isEnabled, featureKey) {
        return isEnabled &&
            (flags.containsKey(featureKey) && flags[featureKey] == true);
      });
    }

    if (kDebugMode) {
      print('Toggly._evaluateFeatureGate - ${jsonEncode(gate)}');
    }

    return negate ? !isEnabled : isEnabled;
  }

  /// Evaluates the value of a feature [gate] for the current feature flags
  /// values.
  ///
  /// Allows testing for ALL or ANY of the features to be true by using the
  /// [requirement] argument.
  ///
  /// Allows negation through the [negate] argument.
  static Future<bool> evaluateFeatureGate(
    List<String> gate, {
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) async {
    return Toggly._featureFlagsSubject.whereNotNull().switchMap(
      (flags) async* {
        yield Toggly._evaluateFeatureGate(flags,
            gate: gate, requirement: requirement, negate: negate);
      },
    ).first;
  }

  void dispose() {
    cancelTimers();
    Toggly._featureFlagsSubject.close();
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
