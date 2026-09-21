import 'dart:io';
import 'dart:typed_data';

Uint8List? gzipTelemetry(Uint8List bytes) =>
    Uint8List.fromList(gzip.encode(bytes));
