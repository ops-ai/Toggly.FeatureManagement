import 'dart:async';
import 'dart:io';

import 'package:feature_flags_toggly/src/services/sync_service.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('WebSocket sync and revision notifications preserve HTTP refresh pin',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final accepted = Completer<WebSocket>();
    server.listen((request) async {
      accepted.complete(await WebSocketTransformer.upgrade(request));
    });

    final sync = SyncService.getInstance;
    sync.stopWebSocket();
    addTearDown(() async {
      sync.stopWebSocket();
      sync.onConnected = null;
      sync.onSyncMessage = null;
      sync.onRefreshRequested = null;
      sync.onDefinitionsRevisionUpdated = null;
      await server.close(force: true);
    });

    final connected = Completer<void>();
    final message = Completer<List<Object?>>();
    final refreshed = Completer<List<Object?>>();
    final confirmed = Completer<String>();
    sync.onConnected = connected.complete;
    sync.onSyncMessage = ({required bool unchanged, String? etag}) =>
        message.complete([unchanged, etag]);
    sync.onRefreshRequested = (
            {required bool forceJwksRefresh, String? pinnedRevision}) async =>
        refreshed.complete([forceJwksRefresh, pinnedRevision]);
    sync.onDefinitionsRevisionUpdated = confirmed.complete;

    sync.startWebSocket(
      baseURI: 'http://127.0.0.1:${server.port}',
      appKey: 'test-app',
      cachedRevision: 'old',
    );
    final socket = await accepted.future;
    await connected.future;

    socket.add('{"type":"sync","unchanged":true,"etag":"old"}');
    expect(await message.future, [true, 'old']);

    socket.add('{"type":"flags-updated","etag":"new"}');
    expect(await refreshed.future, [false, 'new']);

    socket.add('{"type":"flags-updated","etag":"old"}');
    expect(await confirmed.future, 'old');
  });
}
