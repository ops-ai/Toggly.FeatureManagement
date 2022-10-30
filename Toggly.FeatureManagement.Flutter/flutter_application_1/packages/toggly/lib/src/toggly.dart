import 'dart:async';
import 'dart:convert';

import 'package:http_service/http_service.dart';
import 'package:secure_storage_repository/secure_storage_repository.dart';
import 'package:toggly/toggly.dart';
import 'package:uuid/uuid.dart';
import 'package:rxdart/rxdart.dart';

class Toggly {
  static Uuid uuid = Uuid();
  static late String apiKey;
  static late String environment = 'Production';
  static late String identity;
  static late TogglyConfig config;
  static late Map<String, bool> flagDefaults = {};
  static final http = HttpService.getInstance.http;
  static final storage = SecureStorageRepository.getInstance;
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
    Toggly.apiKey = apiKey;
    Toggly.environment = environment ?? 'Production';
    Toggly.identity = identity ?? uuid.v4();
    Toggly.config = config;
    Toggly.flagDefaults = flagDefaults ?? {};

    return await Toggly.refresh();
  }

  static Future<TogglyInitResponse> refresh() async {
    print('Toggly.init');

    try {
      // Try to fetch flags from the API
      var flags = await Toggly.fetchFeatureFlags();

      return TogglyInitResponse(
        status: TogglyLoadFeatureFlagsResponse.fetched,
      );
    } catch (_) {
      // Try to load flags from Cache
      var flags = await Toggly.cachedFeatureFlags;
      var status = TogglyLoadFeatureFlagsResponse.cached;

      if (flags == null) {
        // Otherwise use provided default flags
        flags = Toggly.flagDefaults;
        status = TogglyLoadFeatureFlagsResponse.defaults;
      }

      print('Toggly.loadedFromCache - ' + jsonEncode(flags));

      Toggly._featureFlagsSubject.add(flags);

      return TogglyInitResponse(
        status: status,
      );
    }
  }

  static Future<Map<String, bool>> get featureFlags async {
    try {
      return await Toggly.cachedFeatureFlags ?? await fetchFeatureFlags();
    } catch (_) {
      return Toggly.flagDefaults;
    }
    // try {
    //   String? cachedFlagsJson = await storage.get(
    //       key: '${SecureStorageKeys.featureFlagsCache}/${Toggly.identity}');

    //   return cachedFlagsJson != null
    //       ? Map<String, bool>.from(jsonDecode(cachedFlagsJson))
    //       : await fetchFeatureFlags();
    // } catch (_) {
    //   return Toggly.flagDefaults;
    // }
  }

  static Future<Map<String, bool>?> get cachedFeatureFlags async {
    try {
      String? cachedFlagsJson = await storage.get(
          key: '${SecureStorageKeys.featureFlagsCache}/${Toggly.identity}');

      return cachedFlagsJson != null
          ? Map<String, bool>.from(jsonDecode(cachedFlagsJson))
          : null;
    } catch (_) {
      return null;
    }
  }

  static void cacheFeatureFlags({
    required Map<String, bool> featureFlags,
  }) async {
    await storage.set(
      key: '${SecureStorageKeys.featureFlagsCache}/${Toggly.identity}',
      value: jsonEncode(featureFlags),
    );
  }

  static void clearFeatureFlagsCache() async {
    await storage.delete(
      key: '${SecureStorageKeys.featureFlagsCache}/${Toggly.identity}',
    );
  }

  static Future<Map<String, bool>> fetchFeatureFlags() async {
    try {
      final response = await http.get(
        '${Toggly.config.baseURI}/${Toggly.apiKey}-${Toggly.environment}/defs?u=${Toggly.identity}',
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

      print('Toggly.fetchFeatureFlags - ' + jsonEncode(flags));

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

    print('Toggly.featureGateFuture - ' + jsonEncode(gate));

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
    Toggly._featureFlagsSubject.close();
  }
}
