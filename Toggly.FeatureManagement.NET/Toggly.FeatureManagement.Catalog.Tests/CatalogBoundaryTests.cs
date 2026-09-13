using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogBoundaryTests
{
    public static IEnumerable<object[]> InvalidDocuments()
    {
        static CatalogDocument Document() => new() { Features = [new CatalogFeature { Key = "Checkout", Name = "Checkout" }] };
        static CatalogContextSchema Context() => new() { Kind = "Order", KeyPropertyName = "Id", Properties = [new() { Name = "Id", Type = "string" }] };
        static object[] Case(Action<CatalogDocument> change, string field)
        {
            var document = Document(); change(document); return [document, field];
        }
        yield return Case(d => d.Features = null!, "features");
        yield return Case(d => d.Contexts = null!, "contexts");
        yield return Case(d => d.Features = [null!], "features[0]");
        yield return Case(d => d.Features[0].Rules = null!, "features[0].rules");
        yield return Case(d => d.Features[0].Rules = [null!], "features[0].rules[0]");
        yield return Case(d => d.Features[0].Rules = [new() { Name = "Percentage", Parameters = null! }], "features[0].rules[0].parameters");
        yield return Case(d => d.Features[0].Name = new string('x', 201), "features[0].name");
        yield return Case(d => d.Features[0].Description = new string('x', 8001), "features[0].description");
        yield return Case(d => d.Features[0].RequirementType = (CatalogRequirementType)99, "features[0].requirementType");
        yield return Case(d => d.Features[0].ContextRequirementType = (CatalogRequirementType)99, "features[0].contextRequirementType");
        yield return Case(d => d.Features[0].Tags = null!, "features[0].tags");
        yield return Case(d => d.Features[0].Tags = [new string('x', 101)], "features[0].tags[0]");
        yield return Case(d => d.Features[0].Tags = ["checkout", "CHECKOUT"], "features[0].tags[1]");
        yield return Case(d => d.Contexts = [null!], "contexts[0]");
        yield return Case(d => { var c = Context(); c.Kind = "User"; d.Contexts = [c]; }, "contexts[0].kind");
        yield return Case(d => d.Contexts = [Context(), Context()], "contexts[1].kind");
        yield return Case(d => { var c = Context(); c.Properties = null!; d.Contexts = [c]; }, "contexts[0].properties");
        yield return Case(d => { var c = Context(); c.Properties = []; d.Contexts = [c]; }, "contexts[0].properties");
        yield return Case(d => { var c = Context(); c.Properties.Add(null!); d.Contexts = [c]; }, "contexts[0].properties[1]");
        yield return Case(d => { var c = Context(); c.Properties[0].Type = "object"; d.Contexts = [c]; }, "contexts[0].properties[0].type");
        yield return Case(d => { var c = Context(); c.Properties.Add(new() { Name = "ID", Type = "string" }); d.Contexts = [c]; }, "contexts[0].properties[1].name");
        yield return Case(d => { var c = Context(); c.KeyPropertyName = ""; d.Contexts = [c]; }, "contexts[0].keyPropertyName");
        yield return Case(d => { var c = Context(); c.KeyPropertyName = "Missing"; d.Contexts = [c]; }, "contexts[0].keyPropertyName");
        yield return Case(d => d.Contexts = Enumerable.Range(0, 51).Select(i => new CatalogContextSchema { Kind = "Context" + i, KeyPropertyName = "Id", Properties = [new() { Name = "Id", Type = "string" }] }).ToList(), "contexts");
        yield return Case(d => d.Contexts = [new() { Kind = "Order", KeyPropertyName = "Id0", Properties = Enumerable.Range(0, 101).Select(i => new CatalogContextProperty { Name = "Id" + i, Type = "string" }).ToList() }], "contexts[0].properties");
    }

    [Theory]
    [MemberData(nameof(InvalidDocuments))]
    public void Invalid_catalogs_report_the_affected_field(CatalogDocument document, string field)
    {
        var result = CatalogValidator.Validate(document);
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Path == field);
    }
}
