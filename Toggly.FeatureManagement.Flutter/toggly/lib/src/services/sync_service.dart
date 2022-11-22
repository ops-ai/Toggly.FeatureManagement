import 'dart:async';

class SyncService {
  static final SyncService _instance = SyncService._internal();

  Timer? refreshFeatureFlagsTimer;

  SyncService._internal();

  static SyncService get getInstance => _instance;
}
