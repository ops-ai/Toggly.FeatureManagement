import 'dart:typed_data';

import 'telemetry_compression_stub.dart'
    if (dart.library.io) 'telemetry_compression_io.dart' as platform;

Uint8List? gzipTelemetry(Uint8List bytes) => platform.gzipTelemetry(bytes);
