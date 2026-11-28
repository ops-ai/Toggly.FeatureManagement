using System;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Soft-decode typed variant values from <see cref="IVariantFeatureManager"/> (OPS-2104).
    /// Pass the registered <see cref="IFeatureDefinitionModelProvider"/> (available from DI when
    /// <c>AddToggly()</c> is used) so the declared catalog <see cref="FeatureValueType"/> can be
    /// checked before decoding; when it is omitted, or the feature/variant is not found in the
    /// catalog, these helpers soft-decode directly from the assigned variant's configuration.
    /// Never throw for shape mismatches: a wrong-typed or missing value returns <c>null</c>.
    /// </summary>
    public static class FeatureValueManagerExtensions
    {
        /// <summary>
        /// Gets the assigned variant's value as a <see cref="string"/>.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The string value, or <c>null</c> when disabled, no variant is assigned, or the value is not a string.</returns>
        public static async Task<string?> GetStringValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, cancellationToken).ConfigureAwait(false);
            return DecodeStringValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="string"/> using the provided targeting context.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="context">Targeting context used for variant assignment.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The string value, or <c>null</c> when disabled, no variant is assigned, or the value is not a string.</returns>
        public static async Task<string?> GetStringValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            ITargetingContext context,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, context, cancellationToken).ConfigureAwait(false);
            return DecodeStringValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="double"/>.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The numeric value, or <c>null</c> when disabled, no variant is assigned, or the value is not numeric.</returns>
        public static async Task<double?> GetNumberValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, cancellationToken).ConfigureAwait(false);
            return DecodeNumberValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="double"/> using the provided targeting context.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="context">Targeting context used for variant assignment.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The numeric value, or <c>null</c> when disabled, no variant is assigned, or the value is not numeric.</returns>
        public static async Task<double?> GetNumberValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            ITargetingContext context,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, context, cancellationToken).ConfigureAwait(false);
            return DecodeNumberValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="JsonElement"/> (object or array).
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// (best-effort reconstruction) from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The JSON value, or <c>null</c> when disabled, no variant is assigned, or the value is not a JSON object/array.</returns>
        public static async Task<JsonElement?> GetJsonValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, cancellationToken).ConfigureAwait(false);
            return DecodeJsonValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="JsonElement"/> (object or array) using the provided targeting context.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="context">Targeting context used for variant assignment.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// (best-effort reconstruction) from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The JSON value, or <c>null</c> when disabled, no variant is assigned, or the value is not a JSON object/array.</returns>
        public static async Task<JsonElement?> GetJsonValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            ITargetingContext context,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, context, cancellationToken).ConfigureAwait(false);
            return DecodeJsonValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="DateTimeOffset"/>.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The date/time value, or <c>null</c> when disabled, no variant is assigned, or the value does not parse as a date/time.</returns>
        public static async Task<DateTimeOffset?> GetDateTimeValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, cancellationToken).ConfigureAwait(false);
            return DecodeDateTimeValue(feature, variant, definitions);
        }

        /// <summary>
        /// Gets the assigned variant's value as a <see cref="DateTimeOffset"/> using the provided targeting context.
        /// </summary>
        /// <param name="manager">Variant-aware feature manager.</param>
        /// <param name="feature">Feature name to evaluate.</param>
        /// <param name="context">Targeting context used for variant assignment.</param>
        /// <param name="definitions">
        /// Optional catalog provider used to validate the declared <see cref="FeatureValueType"/>
        /// and resolve the exact configuration value. When omitted, the value is soft-decoded
        /// from the variant's bound configuration instead.
        /// </param>
        /// <param name="cancellationToken">Cancellation token.</param>
        /// <returns>The date/time value, or <c>null</c> when disabled, no variant is assigned, or the value does not parse as a date/time.</returns>
        public static async Task<DateTimeOffset?> GetDateTimeValueAsync(
            this IVariantFeatureManager manager,
            string feature,
            ITargetingContext context,
            IFeatureDefinitionModelProvider? definitions = null,
            CancellationToken cancellationToken = default)
        {
            ThrowIfNullManager(manager);
            var variant = await manager.GetVariantAsync(feature, context, cancellationToken).ConfigureAwait(false);
            return DecodeDateTimeValue(feature, variant, definitions);
        }

        private static void ThrowIfNullManager(IVariantFeatureManager manager)
        {
#if NET6_0_OR_GREATER
            ArgumentNullException.ThrowIfNull(manager);
#else
            if (manager == null)
                throw new ArgumentNullException(nameof(manager));
#endif
        }

        private static string? DecodeStringValue(string feature, Variant? variant, IFeatureDefinitionModelProvider? definitions)
        {
            var resolved = ResolveValue(feature, variant, definitions);
            if (!ValueTypeMatches(resolved.DeclaredType, FeatureValueType.String))
                return null;

            return resolved.Raw.HasValue && resolved.Raw.Value.ValueKind == JsonValueKind.String
                ? resolved.Raw.Value.GetString()
                : null;
        }

        private static double? DecodeNumberValue(string feature, Variant? variant, IFeatureDefinitionModelProvider? definitions)
        {
            var resolved = ResolveValue(feature, variant, definitions);
            if (!ValueTypeMatches(resolved.DeclaredType, FeatureValueType.Number))
                return null;

            if (!resolved.Raw.HasValue)
                return null;

            var element = resolved.Raw.Value;
            if (element.ValueKind == JsonValueKind.Number
                && element.TryGetDouble(out var numberValue)
                && double.IsFinite(numberValue))
                return numberValue;

            if (element.ValueKind == JsonValueKind.String
                && double.TryParse(element.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                && double.IsFinite(parsed))
                return parsed;

            return null;
        }

        private static JsonElement? DecodeJsonValue(string feature, Variant? variant, IFeatureDefinitionModelProvider? definitions)
        {
            var resolved = ResolveValue(feature, variant, definitions);
            if (!ValueTypeMatches(resolved.DeclaredType, FeatureValueType.Json))
                return null;

            if (!resolved.Raw.HasValue)
                return null;

            var element = resolved.Raw.Value;
            if (element.ValueKind == JsonValueKind.Object || element.ValueKind == JsonValueKind.Array)
                return element.Clone();

            if (element.ValueKind == JsonValueKind.String)
            {
                var text = element.GetString();
                if (string.IsNullOrEmpty(text))
                    return null;

                try
                {
                    using (var parsed = JsonDocument.Parse(text))
                    {
                        if (parsed.RootElement.ValueKind == JsonValueKind.Object || parsed.RootElement.ValueKind == JsonValueKind.Array)
                            return parsed.RootElement.Clone();
                    }
                }
                catch (JsonException)
                {
                    return null;
                }
            }

            return null;
        }

        private static DateTimeOffset? DecodeDateTimeValue(string feature, Variant? variant, IFeatureDefinitionModelProvider? definitions)
        {
            var resolved = ResolveValue(feature, variant, definitions);
            if (!ValueTypeMatches(resolved.DeclaredType, FeatureValueType.DateTime))
                return null;

            if (!resolved.Raw.HasValue)
                return null;

            var element = resolved.Raw.Value;
            if (element.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(element.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var fromString))
                return fromString;

            if (element.ValueKind == JsonValueKind.Number && element.TryGetInt64(out var epochMilliseconds))
                return DateTimeOffset.FromUnixTimeMilliseconds(epochMilliseconds);

            return null;
        }

        private static bool ValueTypeMatches(FeatureValueType? declared, FeatureValueType requested)
        {
            // Legacy/undeclared catalogs (null) allow the decode attempt; a declared mismatch soft-nulls.
            return !declared.HasValue || declared.Value == requested;
        }

        private struct ResolvedValue
        {
            public JsonElement? Raw;
            public FeatureValueType? DeclaredType;
        }

        /// <summary>
        /// Resolves the raw JSON value and declared catalog type for the assigned variant.
        /// Prefers the exact catalog <see cref="Toggly.FeatureManagement.Data.VariantDefinition.ConfigurationValue"/> when
        /// <paramref name="definitions"/> is supplied and the feature/variant is found there;
        /// otherwise best-effort reconstructs a <see cref="JsonElement"/> from the variant's
        /// already-bound <see cref="IConfiguration"/> (no declared type is available in that case).
        /// </summary>
        private static ResolvedValue ResolveValue(string feature, Variant? variant, IFeatureDefinitionModelProvider? definitions)
        {
            if (variant == null || string.IsNullOrEmpty(variant.Name))
                return default;

            if (definitions != null && definitions.TryGetFeatureModel(feature, out var model) && model != null && model.Variants != null)
            {
                var catalogVariant = model.Variants.FirstOrDefault(v => string.Equals(v.Name, variant.Name, StringComparison.Ordinal));
                if (catalogVariant != null)
                {
                    return new ResolvedValue
                    {
                        Raw = catalogVariant.ConfigurationValue,
                        DeclaredType = model.ValueType
                    };
                }
            }

            return new ResolvedValue
            {
                Raw = ConfigurationSectionToJsonElement(variant.Configuration),
                DeclaredType = null
            };
        }

        /// <summary>
        /// Best-effort reconstruction of a <see cref="JsonElement"/> from a bound
        /// <see cref="IConfigurationSection"/> when the original catalog JSON is not accessible.
        /// Scalar leaves use type inference (<c>"true"</c>/<c>"false"</c> and parseable numbers
        /// decode as bool/number; everything else decodes as a string), so this is lossy for
        /// string values that look like booleans or numbers. Prefer passing a catalog
        /// <see cref="IFeatureDefinitionModelProvider"/> when exact decoding matters.
        /// </summary>
        private static JsonElement? ConfigurationSectionToJsonElement(IConfigurationSection? section)
        {
            if (section == null)
                return null;

            byte[] bytes;
            using (var stream = new System.IO.MemoryStream())
            {
                using (var writer = new Utf8JsonWriter(stream))
                {
                    WriteConfigurationSection(writer, section);
                }
                bytes = stream.ToArray();
            }

            if (bytes.Length == 0)
                return null;

            try
            {
                using (var document = JsonDocument.Parse(bytes))
                {
                    return document.RootElement.Clone();
                }
            }
            catch (JsonException)
            {
                return null;
            }
        }

        private static void WriteConfigurationSection(Utf8JsonWriter writer, IConfigurationSection section)
        {
            var children = section.GetChildren().ToList();
            if (children.Count == 0)
            {
                WriteScalar(writer, section.Value);
                return;
            }

            var isArray = true;
            for (var i = 0; i < children.Count; i++)
            {
                if (children[i].Key != i.ToString(CultureInfo.InvariantCulture))
                {
                    isArray = false;
                    break;
                }
            }

            if (isArray)
            {
                writer.WriteStartArray();
                foreach (var child in children.OrderBy(c => int.Parse(c.Key, CultureInfo.InvariantCulture)))
                    WriteConfigurationSection(writer, child);
                writer.WriteEndArray();
            }
            else
            {
                writer.WriteStartObject();
                foreach (var child in children)
                {
                    writer.WritePropertyName(child.Key);
                    WriteConfigurationSection(writer, child);
                }
                writer.WriteEndObject();
            }
        }

        private static void WriteScalar(Utf8JsonWriter writer, string? value)
        {
            if (value == null)
            {
                writer.WriteNullValue();
                return;
            }

            if (value == "true")
            {
                writer.WriteBooleanValue(true);
                return;
            }

            if (value == "false")
            {
                writer.WriteBooleanValue(false);
                return;
            }

            // Exclude culture-invariant textual literals ("Infinity"/"NaN") that double.TryParse
            // accepts but that are not valid JSON number tokens.
            if (value != "Infinity" && value != "-Infinity" && value != "NaN"
                && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var numericValue))
            {
                writer.WriteNumberValue(numericValue);
                return;
            }

            writer.WriteStringValue(value);
        }
    }
}
