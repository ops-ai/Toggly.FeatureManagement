/// On-disk (plain JSON file) persistence backend for the Toggly Flutter SDK.
///
/// Provides [DiskCacheProvider], a [TogglyCacheProvider] that stores cache
/// entries as JSON files under the app documents directory.
library feature_flags_toggly_disk;

export 'src/disk_cache_provider.dart';
