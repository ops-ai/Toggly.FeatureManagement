/// Result of evaluating a feature flag variant from Toggly.
class VariantResult {
  /// Whether the feature is enabled for the current identity.
  final bool enabled;

  /// Assigned variant name when [enabled] is true.
  final String? name;

  /// Server-provided configuration payload for the variant (JSON primitive, map, or list).
  final dynamic configurationValue;

  const VariantResult({
    required this.enabled,
    this.name,
    this.configurationValue,
  });
}
