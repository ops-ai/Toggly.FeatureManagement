using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Toggly.FeatureManagement.Catalog
{
    /// <summary>
    /// Raised when a catalog payload is malformed or contains fields outside the portable contract.
    /// </summary>
    public sealed class CatalogFormatException : Exception
    {
        public CatalogFormatException(string message)
            : base(message)
        {
        }

        public CatalogFormatException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }

    /// <summary>
    /// Strict parser and canonical serializer for portable catalog documents.
    /// </summary>
    public static class CatalogJson
    {
        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = false,
            PropertyNamingPolicy = null,
            WriteIndented = false,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
            Converters = { new JsonStringEnumConverter() }
        };

        /// <summary>
        /// Parses, normalizes, and validates a portable catalog payload.
        /// </summary>
        public static CatalogDocument Parse(string json)
        {
            if (json == null) throw new CatalogFormatException("Catalog JSON is required.");

            try
            {
                using (var parsed = JsonDocument.Parse(json, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow }))
                {
                    EnsureUniquePropertyNames(parsed.RootElement, "$" );
                }

                var document = JsonSerializer.Deserialize<CatalogDocument>(json, SerializerOptions);
                if (document == null) throw new CatalogFormatException("Catalog JSON must contain an object.");
                return NormalizeOrThrow(document);
            }
            catch (CatalogFormatException)
            {
                throw;
            }
            catch (JsonException exception)
            {
                throw new CatalogFormatException(exception.Message, exception);
            }
        }

        /// <summary>
        /// Produces canonical JSON after validation and ordering of catalog content.
        /// </summary>
        public static string Serialize(CatalogDocument document)
        {
            var normalized = NormalizeOrThrow(document);
            var canonical = Canonicalize(normalized);
            return JsonSerializer.Serialize(canonical, SerializerOptions);
        }

        private static CatalogDocument NormalizeOrThrow(CatalogDocument document)
        {
            var result = CatalogValidator.NormalizeAndValidate(document);
            if (!result.IsValid)
            {
                throw new CatalogValidationException(result.Errors);
            }

            return result.Document!;
        }

        private static void EnsureUniquePropertyNames(JsonElement element, string path)
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                var names = new HashSet<string>(StringComparer.Ordinal);
                foreach (var property in element.EnumerateObject())
                {
                    if (!names.Add(property.Name))
                    {
                        throw new CatalogFormatException("Duplicate JSON property '" + property.Name + "' at " + path + ".");
                    }

                    EnsureUniquePropertyNames(property.Value, path + "." + property.Name);
                }
            }
            else if (element.ValueKind == JsonValueKind.Array)
            {
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    EnsureUniquePropertyNames(item, path + "[" + index.ToString(System.Globalization.CultureInfo.InvariantCulture) + "]");
                    index++;
                }
            }
        }

        private static CatalogDocument Canonicalize(CatalogDocument source)
        {
            return new CatalogDocument
            {
                SchemaVersion = source.SchemaVersion,
                Environment = source.Environment,
                Features = source.Features.OrderBy(feature => feature.Key, StringComparer.Ordinal).Select(Canonicalize).ToList(),
                Contexts = source.Contexts.OrderBy(context => context.Kind, StringComparer.Ordinal).Select(Canonicalize).ToList()
            };
        }

        private static CatalogFeature Canonicalize(CatalogFeature feature)
        {
            return new CatalogFeature
            {
                Key = feature.Key,
                Name = feature.Name,
                Description = feature.Description,
                Category = string.IsNullOrEmpty(feature.Category) ? null : feature.Category,
                Tags = feature.Tags.OrderBy(tag => tag, StringComparer.Ordinal).ToList(),
                Enabled = feature.Enabled,
                RequirementType = feature.RequirementType,
                ContextKind = feature.ContextKind,
                ContextRequirementType = feature.ContextRequirementType,
                Rules = feature.Rules.Select(rule => new CatalogRule
                {
                    Name = rule.Name,
                    Parameters = rule.Parameters.OrderBy(parameter => parameter.Key, StringComparer.Ordinal)
                        .ToDictionary(parameter => parameter.Key, parameter => parameter.Value, StringComparer.Ordinal)
                }).ToList()
            };
        }

        private static CatalogContextSchema Canonicalize(CatalogContextSchema context)
        {
            return new CatalogContextSchema
            {
                Kind = context.Kind,
                KeyPropertyName = context.KeyPropertyName,
                Properties = context.Properties.OrderBy(property => property.Name, StringComparer.Ordinal)
                    .Select(property => new CatalogContextProperty { Name = property.Name, Type = property.Type }).ToList()
            };
        }
    }
}
