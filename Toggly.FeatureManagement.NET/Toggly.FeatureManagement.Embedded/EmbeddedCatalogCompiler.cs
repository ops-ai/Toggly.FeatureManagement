using Microsoft.FeatureManagement;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Embedded;

internal static class EmbeddedCatalogCompiler
{
    internal static EmbeddedCompiledSnapshot Compile(CatalogSnapshot snapshot)
    {
        var validation = CatalogValidator.NormalizeAndValidate(snapshot.Document);
        if (!validation.IsValid || validation.Document == null) throw new CatalogValidationException(validation.Errors);
        var models = new Dictionary<string, FeatureDefinitionModel>(StringComparer.Ordinal);
        var definitions = new Dictionary<string, FeatureDefinition>(StringComparer.Ordinal);
        var lists = ToListLookup(validation.Document.Lists);
        foreach (var feature in validation.Document.Features)
        {
            var model = new FeatureDefinitionModel
            {
                FeatureKey = feature.Key,
                Filters = feature.Enabled ? CompileFilters(feature, lists) : new List<FeatureFilter>(),
                SecuredFeature = false,
                RequirementType = feature.RequirementType == CatalogRequirementType.All ? RequirementType.All : RequirementType.Any,
                ContextKind = feature.ContextKind,
                ContextRequirementType = ContextRequirementType(feature.ContextRequirementType),
                Metrics = null,
                Variants = null,
                Allocation = null
            };
            models.Add(model.FeatureKey, model);
            definitions.Add(model.FeatureKey, TogglyFeatureProvider.BuildFeatureDefinition(model));
        }
        return new EmbeddedCompiledSnapshot(snapshot.Revision, models, definitions);
    }

    private static RequirementType? ContextRequirementType(CatalogRequirementType? value)
    {
        if (value == null) return null;
        return value == CatalogRequirementType.All ? RequirementType.All : RequirementType.Any;
    }

    private static Dictionary<string, CatalogList> ToListLookup(IEnumerable<CatalogList> lists) =>
        lists.ToDictionary(list => list.Key, StringComparer.OrdinalIgnoreCase);

    private static List<FeatureFilter> CompileFilters(CatalogFeature feature, IReadOnlyDictionary<string, CatalogList> lists)
    {
        return feature.Rules.Select(rule => new FeatureFilter
        {
            Name = rule.Name,
            Parameters = string.Equals(rule.Name, "Targeting", StringComparison.Ordinal)
                ? CatalogListExpansion.ExpandTargetingParameters(rule.Parameters, lists)
                : new Dictionary<string, string>(rule.Parameters, StringComparer.Ordinal)
        }).ToList();
    }
}

internal sealed class EmbeddedCompiledSnapshot
{
    public EmbeddedCompiledSnapshot(string revision, IReadOnlyDictionary<string, FeatureDefinitionModel> models, IReadOnlyDictionary<string, FeatureDefinition> definitions)
    { Revision = revision; Models = models; Definitions = definitions; }
    public string Revision { get; }
    public IReadOnlyDictionary<string, FeatureDefinitionModel> Models { get; }
    public IReadOnlyDictionary<string, FeatureDefinition> Definitions { get; }
}
