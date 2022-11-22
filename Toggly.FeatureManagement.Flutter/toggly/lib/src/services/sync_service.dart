import 'dart:async';

/// Simple service to simplify [Timer] instances management across the package.
class SyncService {
  static final SyncService _instance = SyncService._internal();

  Timer? refreshFeatureFlagsTimer;

  SyncService._internal();

  /// Returns the [SyncService] singleton instance.
  static SyncService get getInstance => _instance;
}
