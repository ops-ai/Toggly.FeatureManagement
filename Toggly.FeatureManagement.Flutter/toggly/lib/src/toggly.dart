import 'dart:async';
import 'dart:convert';

import 'package:toggly/toggly.dart';
import 'package:uuid/uuid.dart';
import 'package:rxdart/rxdart.dart';

class Toggly {
  static Uuid uuid = Uuid();
  static late String _apiKey;
  static late String _environment = 'Production';
  static late String _identity;
  static late TogglyConfig _config;
  static late Map<String, bool> _flagDefaults = {};
  static final _http = HttpService.getInstance.http;
  static final _storage = SecureStorageService.getInstance;
  static final _sync = SyncService.getInstance;
  static final _featureFlagsSubject = BehaviorSubject<Map<String, bool>>();

  static final Toggly _instance = Toggly._internal();

  Toggly._internal();

  factory Toggly() => _instance;

  static Future<TogglyInitResponse> init({
    required String apiKey,
    String? environment,
    String? identity,
    TogglyConfig config = const TogglyConfig(),
    Map<String, bool>? flagDefaults,
  }) async {
    Toggly._apiKey = apiKey;
    Toggly._environment = environment ?? 'Production';
    Toggly._identity = identity ?? uuid.v4();
    Toggly._config = config;
    Toggly._flagDefaults = flagDefaults ?? {};

    if (Toggly._config.isDebug) {
      print('Toggly.init');
    }

    Toggly.startTimers();

    return await Toggly.refresh();
  }

  static Future<TogglyInitResponse> refresh() async {
    if (Toggly._config.isDebug) {
      print('Toggly.refresh');
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
      }

      if (Toggly._config.isDebug) {
        print('Toggly.loadedFromCache - ' + jsonEncode(flags));
      }

      Toggly._featureFlagsSubject.add(flags);

      return TogglyInitResponse(
        status: status,
      );
    }
  }

  static Future<TogglyInitResponse> setIdentity(String? identity) async {
    Toggly._identity = identity ?? uuid.v4();
    return await Toggly.refresh();
  }

  static Future<Map<String, bool>> get featureFlags async {
    try {
      return await Toggly.cachedFeatureFlags ?? await fetchFeatureFlags();
    } catch (_) {
      return Toggly._flagDefaults;
    }
  }

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

  static void clearFeatureFlagsCache() async {
    await _storage.delete(
      key: SecureStorageKeys.featureFlagsCache.toString(),
    );
  }

  static Future<Map<String, bool>> fetchFeatureFlags() async {
    try {
      final response = await _http.get(
        '${Toggly._config.baseURI}/${Toggly._apiKey}-${Toggly._environment}/defs?u=${Toggly._identity}',
        queryParameters: {},
      );

      Map<String, bool> flags = Map<String, bool>.from(response.data);
      // Map<String, bool> flags = Map<String, bool>.from(
      //   jsonDecode(
      //       '{"Test1": true, "Test2": true, "Test3": false, "On": false}'),
      // );

      // Cache flags on successful response
      Toggly.cacheFeatureFlags(featureFlags: flags);

      Toggly._featureFlagsSubject.add(flags);

      if (Toggly._config.isDebug) {
        print('Toggly.fetchFeatureFlags - ' + jsonEncode(flags));
      }

      return flags;
    } catch (_) {
      throw Exception('Failed to fetch feature flags from the API.');
    }
  }

  static Future<bool> evaluateFeatureGate(
    Map<String, bool> flags, {
    required List<String> gate,
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) async {
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

    if (Toggly._config.isDebug) {
      print('Toggly.featureGateFuture - ' + jsonEncode(gate));
    }

    return negate ? !isEnabled : isEnabled;
  }

  static Future<bool> featureGateFuture(
    List<String> gate, {
    FeatureRequirement requirement = FeatureRequirement.all,
    bool negate = false,
  }) async {
    return Toggly._featureFlagsSubject.whereNotNull().switchMap(
      (flags) async* {
        yield await Toggly.evaluateFeatureGate(flags,
            gate: gate, requirement: requirement, negate: negate);
      },
    ).first;
  }

  void dispose() {
    cancelTimers();
    Toggly._featureFlagsSubject.close();
  }

  static void startTimers() {
    cancelTimers();

    Toggly._sync.refreshFeatureFlagsTimer = Timer.periodic(
      Duration(milliseconds: Toggly._config.featureFlagsRefreshInterval),
      (timer) async {
        if (Toggly._config.isDebug) {
          print(
              'Toggly.syncFeatureFlags - every ${Toggly._config.featureFlagsRefreshInterval / 1000}s');
        }

        await Toggly.refresh();
      },
    );
  }

  static void cancelTimers() {
    Toggly._sync.refreshFeatureFlagsTimer?.cancel();
  }
}
