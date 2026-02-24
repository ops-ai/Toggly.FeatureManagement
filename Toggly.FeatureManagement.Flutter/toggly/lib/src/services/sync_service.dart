import 'dart:async';
import 'dart:convert';
import 'dart:io' show WebSocket;

import 'package:flutter/foundation.dart';

/// Simple service to simplify [Timer] instances management across the package.
class SyncService {
  static final SyncService _instance = SyncService._internal();

  Timer? refreshFeatureFlagsTimer;

  /// WebSocket connection for live updates.
  WebSocket? _ws;

  /// Whether the WebSocket is currently connected.
  bool wsConnected = false;

  /// Timer used to schedule reconnection attempts after disconnect.
  Timer? _wsReconnectTimer;

  /// Timestamp of the last fallback refresh performed while WebSocket is connected.
  DateTime lastFallbackRefresh = DateTime(0);

  /// Interval between fallback refreshes when WebSocket is connected.
  static const Duration fallbackRefreshInterval = Duration(minutes: 20);

  /// Delay before attempting to reconnect after a WebSocket disconnect.
  static const Duration wsReconnectDelay = Duration(seconds: 5);

  /// Callback to invoke when a flags-updated message is received.
  Future<void> Function()? onFlagsUpdated;

  SyncService._internal();

  /// Returns the [SyncService] singleton instance.
  static SyncService get getInstance => _instance;

  /// Starts a WebSocket connection for live feature flag updates.
  ///
  /// Derives the WebSocket URL from [baseURI] by replacing the scheme with
  /// `wss://` and appending `/{appKey}/ws`.
  void startWebSocket({required String baseURI, required String appKey}) {
    // Build WebSocket URL from the base URI
    final wsBase = baseURI
        .replaceFirst('https://', 'wss://')
        .replaceFirst('http://', 'ws://');
    final wsUrl = '$wsBase/$appKey/ws';

    if (kDebugMode) {
      print('Toggly: Connecting WebSocket to $wsUrl');
    }

    WebSocket.connect(wsUrl).then((socket) {
      _ws = socket;
      wsConnected = true;
      lastFallbackRefresh = DateTime.now();

      if (kDebugMode) {
        print('Toggly: WebSocket connected');
      }

      socket.listen(
        (data) {
          _handleWebSocketMessage(data);
        },
        onDone: () {
          if (kDebugMode) {
            print('Toggly: WebSocket disconnected');
          }
          wsConnected = false;
          _scheduleReconnect(baseURI: baseURI, appKey: appKey);
        },
        onError: (error) {
          if (kDebugMode) {
            print('Toggly: WebSocket error: $error');
          }
          wsConnected = false;
          _scheduleReconnect(baseURI: baseURI, appKey: appKey);
        },
        cancelOnError: true,
      );
    }).catchError((error) {
      if (kDebugMode) {
        print('Toggly: WebSocket connection failed: $error');
      }
      wsConnected = false;
      _scheduleReconnect(baseURI: baseURI, appKey: appKey);
    });
  }

  /// Handles an incoming WebSocket message.
  void _handleWebSocketMessage(dynamic data) {
    try {
      final message = jsonDecode(data as String) as Map<String, dynamic>;
      final type = message['type'] as String?;

      if (type == 'ping') {
        return;
      }

      if (type == 'flags-updated' || type == 'update') {
        if (kDebugMode) {
          print('Toggly: Received WebSocket flags update (type: $type)');
        }
        onFlagsUpdated?.call();
      }
    } catch (e) {
      if (kDebugMode) {
        print('Toggly: Error parsing WebSocket message: $e');
      }
    }
  }

  /// Schedules a reconnection attempt after a delay.
  void _scheduleReconnect({required String baseURI, required String appKey}) {
    _wsReconnectTimer?.cancel();
    _wsReconnectTimer = Timer(wsReconnectDelay, () {
      if (kDebugMode) {
        print('Toggly: Attempting WebSocket reconnect');
      }
      startWebSocket(baseURI: baseURI, appKey: appKey);
    });
  }

  /// Stops the WebSocket connection and cancels any pending reconnect timer.
  void stopWebSocket() {
    _wsReconnectTimer?.cancel();
    _wsReconnectTimer = null;

    if (_ws != null) {
      _ws!.close().catchError((_) {});
      _ws = null;
    }

    wsConnected = false;

    if (kDebugMode) {
      print('Toggly: WebSocket stopped');
    }
  }
}
