import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'telemetry_compression.dart';
import 'telemetry_browser_stub.dart'
    if (dart.library.html) 'telemetry_browser.dart';

/// An application-scoped, best-effort frontend telemetry buffer.
///
/// The reporter owns its HTTP client so definitions interceptors and their
/// retry/auth behavior cannot affect telemetry requests.
class TelemetryReporter {
  TelemetryReporter({
    required String? appKey,
    String environment = 'Production',
    String? instanceId,
    String? identity,
    bool enableTelemetry = true,
    String metricsBaseUrl = 'https://metrics.toggly.io',
    int telemetryFlushIntervalMs = 45000,
    Dio? httpClient,
    Future<void> Function(Duration)? delay,
    DateTime Function()? clock,
    double Function()? random,
    void Function(String)? onDiagnostic,
    Uint8List? Function(Uint8List)? compressor,
    Duration requestTimeout = const Duration(seconds: 5),
  })  : _appKey = appKey,
        _environment = environment,
        _enabled = enableTelemetry && appKey != null && appKey.isNotEmpty,
        _intervalMs =
            telemetryFlushIntervalMs < 30000 || telemetryFlushIntervalMs > 60000
                ? 45000
                : telemetryFlushIntervalMs,
        _ownsHttpClient = httpClient == null,
        _http = httpClient ?? Dio(),
        _delay = delay,
        _clock = clock ?? DateTime.now,
        _random = random ?? Random().nextDouble,
        _onDiagnostic = onDiagnostic,
        _compressor = compressor ?? gzipTelemetry,
        _requestTimeout = requestTimeout {
    _context = TelemetryContext(this, instanceId, identity);
    if (telemetryFlushIntervalMs < 30000 || telemetryFlushIntervalMs > 60000) {
      _diagnostic('invalid_interval');
    }
    final base = Uri.tryParse(metricsBaseUrl);
    if (base == null ||
        !base.hasAuthority ||
        base.host.isEmpty ||
        (base.scheme != 'http' && base.scheme != 'https') ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment) {
      _enabled = false;
      _diagnostic('invalid_endpoint');
    } else {
      _endpoint = base.replace(
        path:
            '${base.path.replaceFirst(RegExp(r'/+$'), '')}/api/frontend/telemetry',
      );
    }
    if (_enabled) {
      if (_browser.available) {
        _browser.bind(() => unawaited(flushTelemetry(exit: true)));
      }
      _schedule();
    }
  }

  static const int _maxEnvelopeBytes = 49152;
  static const int _maxBufferedBytes = 262144;
  static const int _maxBufferedEntries = 2000;
  static const int _maxServerValue = 1000000;
  static final RegExp _allowedVariant = RegExp(r'[A-Za-z0-9_-]+');

  late TelemetryContext _context;
  String? _appKey;
  String _environment;
  bool _enabled;
  final int _intervalMs;
  final bool _ownsHttpClient;
  final Dio _http;
  final Future<void> Function(Duration)? _delay;
  final DateTime Function() _clock;
  final double Function() _random;
  final void Function(String)? _onDiagnostic;
  final Uint8List? Function(Uint8List) _compressor;
  final Duration _requestTimeout;
  Uri? _endpoint;
  final List<_TelemetryEntry> _buffer = [];
  final List<_TelemetryEnvelope> _pending = [];
  _TelemetryEnvelope? _activeBatch;
  Timer? _timer;
  Timer? _retryTimer;
  Completer<void>? _retryWaiter;
  final Completer<void> _disposedSignal = Completer<void>();
  Future<void>? _draining;
  final BrowserTelemetryTransport _browser = BrowserTelemetryTransport();
  bool _exit = false;
  bool _disposed = false;
  bool _httpClosed = false;
  bool _discarded = false;
  CancelToken? _activeCancel;

  bool get isEnabled => _enabled && !_disposed;

  /// Seals accepted data before replacing the attribution for future events.
  void setContext(
      {String? instanceId,
      String? identity,
      String? appKey,
      String? environment}) {
    if (_disposed) return;
    _snapshot();
    _appKey = appKey ?? _appKey;
    _environment = environment ?? _environment;
    _context = TelemetryContext(this, instanceId, identity);
  }

  TelemetryContext captureContext() => _context;

  void recordCapturedCheck(
      TelemetryContext context, String key, String variant) {
    if (!identical(context._owner, this)) return;
    _recordFeature(key, variant, 0, context);
  }

  void recordCheck(String featureKey, String variant) =>
      _recordFeature(featureKey, variant, 0);

  void recordUsage(String featureKey, [String variant = 'enabled']) =>
      _recordFeature(featureKey, variant, 1);

  void recordView(String featureKey, [String variant = 'enabled']) =>
      _recordFeature(featureKey, variant, 2);

  void incrementCounter(String metricKey, [int value = 1]) =>
      _recordMetric(metricKey, value, false);

  void setGauge(String metricKey, num value) =>
      _recordMetric(metricKey, value, true);

  void _recordFeature(String key, String variant, int field,
      [TelemetryContext? context]) {
    if (key.trim().isEmpty) {
      _diagnostic('invalid_feature');
      return;
    }
    if (variant.length > 64 ||
        _allowedVariant.matchAsPrefix(variant)?.end != variant.length) {
      _diagnostic('invalid_variant');
      return;
    }
    _accept(_TelemetryEntry.feature(key, variant, field), context);
  }

  void _recordMetric(String key, num value, bool gauge) {
    if (key.trim().isEmpty ||
        value.isNaN ||
        value.isInfinite ||
        value < 0 ||
        (gauge && value > _maxServerValue) ||
        (!gauge && (value is! int || value == 0 || value > _maxServerValue))) {
      _diagnostic('invalid_metric');
      return;
    }
    for (final entry in _buffer) {
      if (entry.metric == key && entry.gauge != gauge) {
        _diagnostic('metric_kind_conflict');
        return;
      }
    }
    for (final batch in _pending) {
      if (batch.metricKinds.containsKey(key) &&
          batch.metricKinds[key] != gauge) {
        _diagnostic('metric_kind_conflict');
        return;
      }
    }
    _accept(_TelemetryEntry.metric(key, value, gauge));
  }

  void _accept(_TelemetryEntry entry, [TelemetryContext? context]) {
    if (!_enabled || _disposed) return;
    entry.context = context ?? _context;
    _TelemetryEntry? existing;
    for (final item in _buffer) {
      if (!identical(item.context, entry.context)) continue;
      if (entry.key != null) {
        if (item.key == entry.key &&
            item.variant == entry.variant &&
            item.field == entry.field) {
          existing = item;
          break;
        }
      } else if (item.metric == entry.metric) {
        existing = item;
        break;
      }
    }
    final oldValue = existing?.value;
    if (existing != null) {
      existing.value = entry.gauge ? entry.value : existing.value + entry.value;
    }
    final candidate = existing ?? entry;
    final pendingBytes = _pending.fold<int>(0, (sum, item) => sum + item.bytes);
    final pendingEntries =
        _pending.fold<int>(0, (sum, item) => sum + item.entries);
    final standalone = _TelemetryEnvelope(entry.context);
    final individual = candidate.value > _maxServerValue && !candidate.gauge
        ? (candidate.key != null
            ? _TelemetryEntry.feature(candidate.key, candidate.variant,
                candidate.field, _maxServerValue)
            : _TelemetryEntry.metric(candidate.metric, _maxServerValue, false))
        : candidate;
    // Each eventual chunk repeats its key in the wire format. Count the
    // escaped key on every chunk, even when the buffer has one aggregate.

    var requiredEntries = 0;
    var retainedBytes = pendingBytes;
    for (final item in [..._buffer, if (existing == null) entry]) {
      final headerBytes = _TelemetryEnvelope(item.context).bytes;
      final split = item.key != null || !item.gauge;
      final whole = split ? (item.value as int) ~/ _maxServerValue : 0;
      final remainder = split ? (item.value as int) % _maxServerValue : 0;
      requiredEntries += split ? whole + (remainder > 0 ? 1 : 0) : 1;
      if (whole > 0) {
        retainedBytes +=
            whole * (_entryBytes(item, _maxServerValue) + headerBytes + 32);
      }
      if (!split || remainder > 0) {
        retainedBytes += _entryBytes(item, split ? remainder : item.value) +
            headerBytes +
            32;
      }
    }
    if (requiredEntries + pendingEntries > _maxBufferedEntries ||
        retainedBytes > _maxBufferedBytes ||
        !standalone.tryAdd(individual)) {
      if (existing != null) existing.value = oldValue!;
      _diagnostic('buffer_full');
      return;
    }
    if (existing == null) _buffer.add(entry);
  }

  int _entryBytes(_TelemetryEntry item, num value) {
    final projected = item.key != null
        ? _TelemetryEntry.feature(
            item.key, item.variant, item.field, value as int)
        : _TelemetryEntry.metric(item.metric, value, item.gauge);
    return utf8.encode(jsonEncode(projected.toJson())).length;
  }

  /// Flushes accepted data. Only HTTP 202 acknowledges a batch.
  Future<void> flushTelemetry({bool exit = false}) {
    if (exit) _exit = true;
    if (!_enabled || (_disposed && _buffer.isEmpty && _pending.isEmpty)) {
      if (_disposed && _draining == null) _closeOwnedHttpClient();
      return _draining ?? Future<void>.value();
    }
    _snapshot();
    return _draining ??= _drain().whenComplete(() {
      _draining = null;
      _exit = false;
      if (_disposed) _closeOwnedHttpClient();
    });
  }

  void _snapshot() {
    if (_buffer.isEmpty) return;
    final entries = List<_TelemetryEntry>.from(_buffer);
    _buffer.clear();
    // Batches are immutable after snapshot: subsequent writes cannot relabel
    // or alter an inflight request.
    for (final entry in entries) {
      _append(entry);
    }
  }

  void _append(_TelemetryEntry entry) {
    if ((entry.key != null || !entry.gauge) && entry.value > _maxServerValue) {
      var remaining = entry.value as int;
      while (remaining > 0) {
        final chunk = min(remaining, _maxServerValue);
        _append((entry.key != null
            ? _TelemetryEntry.feature(
                entry.key, entry.variant, entry.field, chunk)
            : _TelemetryEntry.metric(entry.metric, chunk, false))
          ..context = entry.context);
        remaining -= chunk;
      }
      return;
    }
    if (_pending.isEmpty ||
        !identical(_pending.last.context, entry.context) ||
        identical(_pending.last, _activeBatch) ||
        !_pending.last.tryAdd(entry)) {
      final envelope = _TelemetryEnvelope(entry.context);
      if (envelope.tryAdd(entry)) {
        _pending.add(envelope);
      } else {
        _diagnostic('entry_too_large');
      }
    }
  }

  Future<void> _drain() async {
    while (_pending.isNotEmpty) {
      final batch = _pending.first;
      _activeBatch = batch;
      final started = _clock();
      var retries = 0;
      while (true) {
        int? status;
        String? retryAfter;
        final cancelToken = CancelToken();
        _activeCancel = cancelToken;
        try {
          final body = utf8.encode(jsonEncode(batch.toJson()));
          if (_browser.available) {
            final response = await _browser.send(
                _endpoint!, Uint8List.fromList(body),
                exit: () => _disposed || _exit,
                cancelled: () => _discarded,
                timeout: _requestTimeout);
            status = response['status'] as int?;
            retryAfter = response['retryAfter'] as String?;
          } else {
            Uint8List? compressed;
            if (!_disposed && !_exit) {
              try {
                compressed = _compressor(Uint8List.fromList(body));
              } catch (_) {
                _diagnostic('compression_failure');
              }
            }
            final response = await _http
                .postUri<dynamic>(
                  _endpoint!,
                  data: compressed ?? utf8.decode(body),
                  cancelToken: cancelToken,
                  options: Options(
                    contentType: 'application/json',
                    headers: compressed == null
                        ? null
                        : {'Content-Encoding': 'gzip'},
                    sendTimeout: _requestTimeout,
                    receiveTimeout: _requestTimeout,
                    validateStatus: (_) => true,
                    followRedirects: false,
                  ),
                )
                .timeout(_requestTimeout);
            status = response.statusCode;
            retryAfter = response.headers.value('retry-after');
          }
        } on TimeoutException {
          cancelToken.cancel('telemetry_timeout');
          _diagnostic('transport_timeout');
        } catch (_) {
          _diagnostic('transport_failure');
        }
        if (status == 202) break;
        if (_disposed || (status != 429 && status != 503) || retries >= 2) {
          _diagnostic('batch_dropped');
          break;
        }
        final backoff = Duration(seconds: retries == 0 ? 30 : 60);
        final wait = _retryAfter(retryAfter, backoff);
        if (_clock().difference(started) + wait > const Duration(minutes: 5)) {
          _diagnostic('batch_expired');
          break;
        }
        retries++;
        await _waitForRetry(wait);
        if (_disposed) break;
        if (_clock().difference(started) > const Duration(minutes: 5)) {
          _diagnostic('batch_expired');
          break;
        }
      }
      if (_pending.isNotEmpty && identical(_pending.first, batch)) {
        _pending.removeAt(0);
      }
      _activeCancel = null;
      _activeBatch = null;
      if (_disposed) {
        _pending.clear();
        _buffer.clear();
        break;
      }
      _snapshot();
    }
  }

  Future<void> _waitForRetry(Duration wait) {
    final injected = _delay;
    if (injected != null) {
      return Future.any<void>([injected(wait), _disposedSignal.future]);
    }
    final waiter = Completer<void>();
    _retryWaiter = waiter;
    _retryTimer = Timer(wait, () {
      _retryTimer = null;
      _retryWaiter = null;
      waiter.complete();
    });
    return waiter.future;
  }

  Duration _retryAfter(String? raw, Duration minimum) {
    if (raw == null) return minimum;
    final seconds = int.tryParse(raw.trim());
    final date = DateTime.tryParse(raw) ?? _parseHttpDate(raw);
    final parsed = seconds == null
        ? date?.difference(_clock())
        : Duration(seconds: seconds);
    return parsed != null && parsed > minimum ? parsed : minimum;
  }

  DateTime? _parseHttpDate(String raw) {
    final match = RegExp(
      r'^[A-Za-z]{3},\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$',
    ).firstMatch(raw.trim());
    if (match == null) return null;
    const months = <String, int>{
      'Jan': 1,
      'Feb': 2,
      'Mar': 3,
      'Apr': 4,
      'May': 5,
      'Jun': 6,
      'Jul': 7,
      'Aug': 8,
      'Sep': 9,
      'Oct': 10,
      'Nov': 11,
      'Dec': 12,
    };
    final month = months[match.group(2)];
    if (month == null) return null;
    return DateTime.utc(
      int.parse(match.group(3)!),
      month,
      int.parse(match.group(1)!),
      int.parse(match.group(4)!),
      int.parse(match.group(5)!),
      int.parse(match.group(6)!),
    );
  }

  void _schedule() {
    if (_disposed || !_enabled) return;
    final millis = (_intervalMs * (0.8 + _random() * 0.4)).round();
    _timer = Timer(Duration(milliseconds: millis), () {
      unawaited(flushTelemetry());
      _schedule();
    });
  }

  void _diagnostic(String code) {
    try {
      _onDiagnostic?.call(code);
    } catch (_) {
      // Diagnostics must never alter evaluations or requests.
    }
  }

  void _closeOwnedHttpClient() {
    if (_ownsHttpClient && !_httpClosed) {
      _httpClosed = true;
      _http.close(force: true);
    }
  }

  /// Releases timers and starts one bounded, best-effort final request.
  void dispose({bool flush = true}) {
    if (!flush) {
      _discarded = true;
      _buffer.clear();
      _pending.clear();
      _activeCancel?.cancel('telemetry_disposed');
      _browser.cancel();
      _closeOwnedHttpClient();
    }
    if (_disposed) return;
    _disposed = true;
    _browser.dispose();
    _disposedSignal.complete();
    _timer?.cancel();
    _retryTimer?.cancel();
    _retryTimer = null;
    final waiter = _retryWaiter;
    _retryWaiter = null;
    if (waiter != null && !waiter.isCompleted) waiter.complete();
    unawaited(flushTelemetry());
  }
}

class _TelemetryEntry {
  _TelemetryEntry.feature(this.key, this.variant, this.field, [this.value = 1])
      : metric = null,
        gauge = false;
  _TelemetryEntry.metric(this.metric, this.value, this.gauge)
      : key = null,
        variant = null,
        field = null;

  late TelemetryContext context;
  final String? key;
  final String? variant;
  final int? field;
  final String? metric;
  num value;
  final bool gauge;

  Object toJson() =>
      key != null ? [key, variant, field, value] : [metric, value, gauge];
}

class _TelemetryEnvelope {
  _TelemetryEnvelope(this.context)
      : appKey = context._appKey!,
        environment = context._environment;
  final TelemetryContext context;
  final String appKey;
  final String environment;
  final Map<String, Map<String, List<int>>> features = {};
  final Map<String, num> metrics = {};
  final Map<String, bool> metricKinds = {};
  int entries = 0;

  int get bytes => utf8.encode(jsonEncode(toJson())).length;

  bool tryAdd(_TelemetryEntry entry) {
    if (entries >= 2000) return false;
    if (entry.key != null) {
      final variants = features[entry.key];
      final hadVariant = variants?.containsKey(entry.variant) ?? false;
      if (variants != null && !hadVariant && variants.length >= 16) {
        return false;
      }
      final counts = variants?[entry.variant] ?? [0, 0, 0];
      if (counts[entry.field!] >= 1000000) return false;
      final next = List<int>.from(counts);
      next[entry.field!] += entry.value as int;
      if (next[entry.field!] > 1000000) return false;
      (features[entry.key!] ??= {})[entry.variant!] = next;
      if (bytes > TelemetryReporter._maxEnvelopeBytes) {
        if (!hadVariant) {
          features[entry.key!]!.remove(entry.variant);
          if (features[entry.key!]!.isEmpty) features.remove(entry.key);
        } else {
          features[entry.key!]![entry.variant!] = counts;
        }
        return false;
      }
    } else {
      final previous = metrics[entry.metric];
      if (previous != null && metricKinds[entry.metric] != entry.gauge) {
        return false;
      }
      final next = entry.gauge ? entry.value : (previous ?? 0) + entry.value;
      if (next > 1000000) return false;
      metrics[entry.metric!] = next;
      metricKinds[entry.metric!] = entry.gauge;
      if (bytes > TelemetryReporter._maxEnvelopeBytes) {
        if (previous == null) {
          metrics.remove(entry.metric);
          metricKinds.remove(entry.metric);
        } else {
          metrics[entry.metric!] = previous;
        }
        return false;
      }
    }
    entries++;
    return true;
  }

  Map<String, Object> toJson() {
    final fields = <String, Object>{
      'k': appKey,
      'e': environment,
      ...context.fields
    };
    if (features.isNotEmpty) {
      fields['f'] = features.map((key, variants) => MapEntry(
          key,
          variants.map((variant, counts) => MapEntry(variant,
              counts.sublist(0, counts.lastIndexWhere((n) => n != 0) + 1)))));
    }
    if (metrics.isNotEmpty) fields['m'] = metrics;
    return fields;
  }
}

/// Immutable attribution snapshot, accepted only by the reporter that owns it.
class TelemetryContext {
  TelemetryContext(this._owner, String? instanceId, String? identity)
      : _appKey = _owner._appKey,
        _environment = _owner._environment,
        fields = Map.unmodifiable(_fields(instanceId, identity));
  final TelemetryReporter _owner;
  final String? _appKey;
  final String _environment;
  final Map<String, String> fields;
  static Map<String, String> _fields(String? instanceId, String? identity) {
    final token = instanceId?.trim();
    final user = identity?.trim();
    if (token != null && token.isNotEmpty) return {'i': token};
    if (user != null && user.isNotEmpty) return {'u': user};
    return {};
  }
}
