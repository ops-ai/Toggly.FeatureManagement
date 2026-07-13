import 'dart:async';
import 'dart:convert';
import 'dart:io' show WebSocket;

import './sdk_identity.dart';
import 'dart:math' show min, pow;

import 'package:flutter/foundation.dart';

/// Header used by Toggly definitions endpoints for revision (falls back to ETag).
const definitionsRevisionHeader = 'X-Definitions-Revision';

/// WebSocket sync payload from the definitions worker.
class WsSyncMessage {
  const WsSyncMessage({
    required this.type,
    this.etag,
    this.unchanged,
  });

  final String type;
  final String? etag;
  final bool? unchanged;

  factory WsSyncMessage.fromJson(Map<String, dynamic> json) {
    return WsSyncMessage(
      type: json['type'] as String? ?? '',
      etag: json['etag'] as String?,
      unchanged: json['unchanged'] as bool?,
    );
  }
}

/// Simple service to simplify [Timer] instances management across the package.
class SyncService {
  static final SyncService _instance = SyncService._internal();

  Timer? refreshFeatureFlagsTimer;

  /// WebSocket connection for live updates.
  WebSocket? _ws;

  /// Whether the WebSocket is currently connected.
  bool wsConnected = false;

  /// Whether a reconnect attempt is scheduled or in progress.
  bool wsReconnecting = false;

  /// Timer used to schedule reconnection attempts after disconnect.
  Timer? _wsReconnectTimer;

  /// Debounce timer for coalescing refresh callbacks.
  Timer? _refreshDebounceTimer;

  /// Exponential backoff attempt counter (reset on successful connect).
  int _wsReconnectAttempt = 0;

  /// Base delay before the first reconnect attempt.
  static const Duration wsReconnectBaseDelay = Duration(seconds: 5);

  /// Maximum delay between reconnect attempts.
  static const Duration wsReconnectMaxDelay = Duration(seconds: 60);

  /// Debounce window for refresh callbacks triggered by WebSocket messages.
  static const Duration refreshDebounceDelay = Duration(milliseconds: 300);

  String? _baseURI;
  String? _appKey;
  String? _cachedRevision;

  /// Callback for WebSocket `sync` messages.
  void Function({required bool unchanged, String? etag})? onSyncMessage;

  /// Debounced callback when definitions should be refreshed from the API.
  Future<void> Function({required bool forceJwksRefresh})? onRefreshRequested;

  /// Called when a WebSocket message carries a new definitions revision.
  void Function(String etag)? onDefinitionsRevisionUpdated;

  /// Called after the WebSocket successfully connects (including reconnects).
  VoidCallback? onConnected;

  SyncService._internal();

  /// Returns the [SyncService] singleton instance.
  static SyncService get getInstance => _instance;

  /// Computes the next reconnect delay using exponential backoff.
  static Duration reconnectDelayForAttempt(int attempt) {
    final ms = min(
      wsReconnectBaseDelay.inMilliseconds * pow(2, attempt).toInt(),
      wsReconnectMaxDelay.inMilliseconds,
    );
    return Duration(milliseconds: ms);
  }

  /// Updates the cached revision used for reconnect `?rev=` query params.
  void updateCachedRevision(String? revision) {
    _cachedRevision = revision;
  }

  /// Starts a WebSocket connection for live feature flag updates.
  ///
  /// Derives the WebSocket URL from [baseURI] by replacing the scheme with
  /// `wss://`, appending `/{appKey}/ws`, and optionally `?rev=` when
  /// [cachedRevision] is set.
  void startWebSocket({
    required String baseURI,
    required String appKey,
    String? cachedRevision,
  }) {
    _baseURI = baseURI;
    _appKey = appKey;
    _cachedRevision = cachedRevision;

    final wsUrl = _buildWebSocketUrl(baseURI, appKey, cachedRevision);

    if (kDebugMode) {
      print('Toggly: Connecting WebSocket to $wsUrl');
    }

    WebSocket.connect(wsUrl).then((socket) {
      _ws = socket;
      wsConnected = true;
      wsReconnecting = false;
      _wsReconnectAttempt = 0;

      if (kDebugMode) {
        print('Toggly: WebSocket connected');
      }

      onConnected?.call();

      socket.listen(
        (data) {
          _handleWebSocketMessage(data);
        },
        onDone: () {
          if (kDebugMode) {
            print('Toggly: WebSocket disconnected');
          }
          wsConnected = false;
          _scheduleReconnect();
        },
        onError: (error) {
          if (kDebugMode) {
            print('Toggly: WebSocket error: $error');
          }
          wsConnected = false;
          _scheduleReconnect();
        },
        cancelOnError: true,
      );
    }).catchError((error) {
      if (kDebugMode) {
        print('Toggly: WebSocket connection failed: $error');
      }
      wsConnected = false;
      _scheduleReconnect();
    });
  }

  /// Schedules a debounced definitions refresh.
  void requestRefresh({bool forceJwksRefresh = false}) {
    _refreshDebounceTimer?.cancel();
    _refreshDebounceTimer = Timer(refreshDebounceDelay, () {
      _refreshDebounceTimer = null;
      onRefreshRequested?.call(forceJwksRefresh: forceJwksRefresh);
    });
  }

  /// Handles an incoming WebSocket message.
  void _handleWebSocketMessage(dynamic data) {
    try {
      if (data is! String) {
        return;
      }

      if (data == 'update' || data == 'flags-updated') {
        if (kDebugMode) {
          print('Toggly: Received WebSocket text update: $data');
        }
        requestRefresh();
        return;
      }

      final message = WsSyncMessage.fromJson(
        jsonDecode(data) as Map<String, dynamic>,
      );

      if (message.type == 'ping') {
        return;
      }

      if (message.type == 'sync') {
        if (kDebugMode) {
          print(
            'Toggly: Received WebSocket sync (unchanged: ${message.unchanged})',
          );
        }
        onSyncMessage?.call(
          unchanged: message.unchanged == true,
          etag: message.etag,
        );
        return;
      }

      if (message.type == 'signing-key-updated') {
        if (kDebugMode) {
          print('Toggly: Received WebSocket signing-key-updated');
        }
        requestRefresh(forceJwksRefresh: true);
        return;
      }

      if (message.type == 'flags-updated' || message.type == 'update') {
        if (kDebugMode) {
          print(
              'Toggly: Received WebSocket flags update (type: ${message.type})');
        }
        if (_shouldFetchOnFlagsUpdated(message)) {
          requestRefresh();
        }
        if (message.etag != null && message.etag!.isNotEmpty) {
          onDefinitionsRevisionUpdated?.call(message.etag!);
        }
        return;
      }
    } catch (e) {
      if (kDebugMode) {
        print('Toggly: Error parsing WebSocket message: $e');
      }
    }
  }

  bool _shouldFetchOnFlagsUpdated(WsSyncMessage message) {
    if (message.type != 'flags-updated') {
      return true;
    }
    final cached = _cachedRevision;
    if (message.etag == null || cached == null || cached.isEmpty) {
      return true;
    }
    return message.etag != cached;
  }

  /// Schedules a reconnection attempt with exponential backoff.
  void _scheduleReconnect() {
    final baseURI = _baseURI;
    final appKey = _appKey;
    if (baseURI == null || appKey == null) {
      return;
    }

    wsReconnecting = true;
    _wsReconnectTimer?.cancel();
    final delay = reconnectDelayForAttempt(_wsReconnectAttempt);
    _wsReconnectAttempt += 1;

    if (kDebugMode) {
      print('Toggly: WebSocket reconnect in ${delay.inMilliseconds}ms');
    }

    _wsReconnectTimer = Timer(delay, () {
      if (kDebugMode) {
        print('Toggly: Attempting WebSocket reconnect');
      }
      startWebSocket(
        baseURI: baseURI,
        appKey: appKey,
        cachedRevision: _cachedRevision,
      );
    });
  }

  String _buildWebSocketUrl(
    String baseURI,
    String appKey,
    String? cachedRevision,
  ) {
    final wsBase = baseURI
        .replaceFirst('https://', 'wss://')
        .replaceFirst('http://', 'ws://')
        .replaceAll(RegExp(r'/$'), '');
    final query = appendSdkQueryString(cachedRevision: cachedRevision);
    return '$wsBase/$appKey/ws?$query';
  }

  /// Stops the WebSocket connection and cancels pending timers.
  void stopWebSocket() {
    _wsReconnectTimer?.cancel();
    _wsReconnectTimer = null;
    _refreshDebounceTimer?.cancel();
    _refreshDebounceTimer = null;

    if (_ws != null) {
      _ws!.close().catchError((_) {});
      _ws = null;
    }

    wsConnected = false;
    wsReconnecting = false;
    _wsReconnectAttempt = 0;

    if (kDebugMode) {
      print('Toggly: WebSocket stopped');
    }
  }
}

bool shouldFetchOnSync({
  required bool unchanged,
  String? messageEtag,
  String? cachedRevision,
  bool hasSuccessfulSync = true,
}) {
  // Until the SDK has completed at least one successful HTTP definitions
  // fetch, WebSocket "unchanged" must not suppress the initial pull.
  if (!hasSuccessfulSync) {
    return true;
  }
  if (unchanged) {
    return false;
  }
  if (cachedRevision == null || cachedRevision.isEmpty) {
    return true;
  }
  if (messageEtag != null && messageEtag != cachedRevision) {
    return true;
  }
  return false;
}
