using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Context;

namespace Toggly.FeatureManagement.Embedded;

/// <summary>Projects host-registered entity contexts into the portable embedded catalog shape.</summary>
public sealed class EmbeddedContextSchemaProvider
{
    private readonly EntityContextRegistry _registry;
    internal EmbeddedContextSchemaProvider(EntityContextRegistry registry) => _registry = registry;

    public IReadOnlyList<CatalogContextSchema> GetRegisteredSchemas() => _registry.GetAll()
        .OrderBy(registration => registration.Kind, StringComparer.Ordinal)
        .Select(registration =>
        {
            var properties = registration.SchemaProperties
                .OrderBy(property => property.Name, StringComparer.Ordinal)
                .Select(property => new CatalogContextProperty { Name = property.Name, Type = property.Type })
                .ToList();
            // The registry's key selector always produces a string, independently
            // of which entity attributes the host exposes for property rules.
            if (!properties.Any(property => string.Equals(property.Name, registration.KeyPropertyName, StringComparison.OrdinalIgnoreCase)))
                properties.Add(new CatalogContextProperty { Name = registration.KeyPropertyName, Type = "string" });
            return new CatalogContextSchema
            {
                Kind = registration.Kind,
                KeyPropertyName = registration.KeyPropertyName,
                Properties = properties.OrderBy(property => property.Name, StringComparer.Ordinal).ToList()
            };
        }).ToList();
}
