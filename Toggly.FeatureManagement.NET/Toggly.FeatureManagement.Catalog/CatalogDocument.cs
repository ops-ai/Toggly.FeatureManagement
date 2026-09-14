using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Toggly.FeatureManagement.Catalog
{
    /// <summary>
    /// The portable, versioned representation of one embedded feature catalog.
    /// </summary>
    public sealed class CatalogDocument
    {
        /// <summary>
        /// Gets or sets the catalog document schema version.
        /// </summary>
        [JsonPropertyName("schemaVersion")]
        public int SchemaVersion { get; set; } = 1;

        /// <summary>
        /// Gets or sets the single logical environment represented by the catalog.
        /// </summary>
        [JsonPropertyName("environment")]
        public string Environment { get; set; } = "Production";

        /// <summary>
        /// Gets or sets the editable feature catalog.
        /// </summary>
        [JsonPropertyName("features")]
        public List<CatalogFeature> Features { get; set; } = new List<CatalogFeature>();

        /// <summary>
        /// Gets or sets the retained entity-context schemas.
        /// </summary>
        [JsonPropertyName("contexts")]
        public List<CatalogContextSchema> Contexts { get; set; } = new List<CatalogContextSchema>();
    }

    /// <summary>
    /// Editable definition of one feature.
    /// </summary>
    public sealed class CatalogFeature
    {
        [JsonPropertyName("key")]
        public string Key { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("description")]
        public string Description { get; set; } = string.Empty;

        [JsonPropertyName("category")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Category { get; set; } = string.Empty;

        [JsonPropertyName("tags")]
        public List<string> Tags { get; set; } = new List<string>();

        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; }

        [JsonPropertyName("requirementType")]
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public CatalogRequirementType RequirementType { get; set; } = CatalogRequirementType.Any;

        [JsonPropertyName("contextKind")]
        public string? ContextKind { get; set; }

        [JsonPropertyName("contextRequirementType")]
        [JsonConverter(typeof(JsonStringEnumConverter))]
        public CatalogRequirementType? ContextRequirementType { get; set; }

        [JsonPropertyName("rules")]
        public List<CatalogRule> Rules { get; set; } = new List<CatalogRule>();
    }

    /// <summary>
    /// A portable feature filter with flattened parameters compatible with the SDK definition format.
    /// </summary>
    public sealed class CatalogRule
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("parameters")]
        public Dictionary<string, string> Parameters { get; set; } = new Dictionary<string, string>(StringComparer.Ordinal);
    }

    /// <summary>
    /// An entity-context schema retained with the catalog.
    /// </summary>
    public sealed class CatalogContextSchema
    {
        [JsonPropertyName("kind")]
        public string Kind { get; set; } = string.Empty;

        [JsonPropertyName("keyPropertyName")]
        public string KeyPropertyName { get; set; } = string.Empty;

        [JsonPropertyName("properties")]
        public List<CatalogContextProperty> Properties { get; set; } = new List<CatalogContextProperty>();
    }

    /// <summary>
    /// One property in an entity-context schema.
    /// </summary>
    public sealed class CatalogContextProperty
    {
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("type")]
        public string Type { get; set; } = string.Empty;
    }

    /// <summary>
    /// Defines how a group of rules is combined.
    /// </summary>
    public enum CatalogRequirementType
    {
        /// <summary>At least one rule must match.</summary>
        Any,

        /// <summary>Every rule must match.</summary>
        All
    }

    /// <summary>
    /// A persisted catalog together with storage identity and optimistic-concurrency metadata.
    /// </summary>
    public sealed class CatalogSnapshot
    {
        public string CatalogName { get; set; } = string.Empty;

        public string Revision { get; set; } = string.Empty;

        public DateTimeOffset UpdatedAtUtc { get; set; }

        public CatalogDocument Document { get; set; } = new CatalogDocument();
    }
}
