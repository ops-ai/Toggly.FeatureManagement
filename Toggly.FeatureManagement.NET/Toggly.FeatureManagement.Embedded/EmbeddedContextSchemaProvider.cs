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
        .Select(registration => new CatalogContextSchema
        {
            Kind = registration.Kind,
            KeyPropertyName = registration.KeyPropertyName,
            Properties = registration.SchemaProperties
                .OrderBy(property => property.Name, StringComparer.Ordinal)
                .Select(property => new CatalogContextProperty { Name = property.Name, Type = property.Type })
                .ToList()
        }).ToList();
}
