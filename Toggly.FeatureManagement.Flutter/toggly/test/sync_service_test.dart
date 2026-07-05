import 'package:flutter_test/flutter_test.dart';
import 'package:feature_flags_toggly/src/services/sync_service.dart';

void main() {
  group('shouldFetchOnSync', () {
    test('skips fetch when unchanged is true', () {
      expect(
        shouldFetchOnSync(
          unchanged: true,
          messageEtag: 'abc',
          cachedRevision: 'abc',
        ),
        isFalse,
      );
    });

    test('fetches when no cached revision', () {
      expect(
        shouldFetchOnSync(
          unchanged: false,
          messageEtag: 'abc',
          cachedRevision: null,
        ),
        isTrue,
      );
    });

    test('fetches when etag differs from cache', () {
      expect(
        shouldFetchOnSync(
          unchanged: false,
          messageEtag: 'new',
          cachedRevision: 'old',
        ),
        isTrue,
      );
    });

    test('skips fetch when etag matches cache', () {
      expect(
        shouldFetchOnSync(
          unchanged: false,
          messageEtag: 'same',
          cachedRevision: 'same',
        ),
        isFalse,
      );
    });
  });

  group('SyncService.reconnectDelayForAttempt', () {
    test('exponentially backs off up to the max delay', () {
      expect(SyncService.reconnectDelayForAttempt(0), const Duration(seconds: 5));
      expect(SyncService.reconnectDelayForAttempt(1), const Duration(seconds: 10));
      expect(SyncService.reconnectDelayForAttempt(10), const Duration(seconds: 60));
    });
  });

  group('WsSyncMessage.fromJson', () {
    test('parses sync payload with unchanged flag', () {
      final message = WsSyncMessage.fromJson({
        'type': 'sync',
        'etag': 'rev123',
        'unchanged': true,
      });

      expect(message.type, 'sync');
      expect(message.etag, 'rev123');
      expect(message.unchanged, isTrue);
    });
  });
}
