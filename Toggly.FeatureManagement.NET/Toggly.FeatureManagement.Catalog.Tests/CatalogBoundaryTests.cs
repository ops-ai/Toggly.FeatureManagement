using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogBoundaryTests
{
    public static TheoryData<CatalogDocument, string> InvalidDocuments()
    {
        static CatalogDocument Document() => new() { Features = [new CatalogFeature { Key = "Checkout", Name = "Checkout" }] };
        static CatalogContextSchema Context() => new() { Kind = "Order", KeyPropertyName = "Id", Properties = [new() { Name = "Id", Type = "string" }] };
        var data = new TheoryData<CatalogDocument, string>();
        void Case(Action<CatalogDocument> change, string field)
        {
            var document = Document(); change(document); data.Add(document, field);
        }
        Case(d => d.Features = null!, "features");
        Case(d => d.Contexts = null!, "contexts");
        Case(d => d.Features = [null!], "features[0]");
        Case(d => d.Features[0].Rules = null!, "features[0].rules");
        Case(d => d.Features[0].Rules = [null!], "features[0].rules[0]");
        Case(d => d.Features[0].Rules = [new() { Name = "Percentage", Parameters = null! }], "features[0].rules[0].parameters");
        Case(d => d.Features[0].Name = new string('x', 201), "features[0].name");
        Case(d => d.Features[0].Category = new string('x', 201), "features[0].category");
        Case(d => d.Features[0].Description = new string('x', 8001), "features[0].description");
        Case(d => d.Features[0].RequirementType = (CatalogRequirementType)99, "features[0].requirementType");
        Case(d => d.Features[0].ContextRequirementType = (CatalogRequirementType)99, "features[0].contextRequirementType");
        Case(d => d.Features[0].Tags = null!, "features[0].tags");
        Case(d => d.Features[0].Tags = [new string('x', 101)], "features[0].tags[0]");
        Case(d => d.Features[0].Tags = ["checkout", "CHECKOUT"], "features[0].tags[1]");
        Case(d => d.Contexts = [null!], "contexts[0]");
        Case(d => { var c = Context(); c.Kind = "User"; d.Contexts = [c]; }, "contexts[0].kind");
        Case(d => d.Contexts = [Context(), Context()], "contexts[1].kind");
        Case(d => { var c = Context(); c.Properties = null!; d.Contexts = [c]; }, "contexts[0].properties");
        Case(d => { var c = Context(); c.Properties = []; d.Contexts = [c]; }, "contexts[0].properties");
        Case(d => { var c = Context(); c.Properties.Add(null!); d.Contexts = [c]; }, "contexts[0].properties[1]");
        Case(d => { var c = Context(); c.Properties[0].Type = "object"; d.Contexts = [c]; }, "contexts[0].properties[0].type");
        Case(d => { var c = Context(); c.Properties.Add(new() { Name = "ID", Type = "string" }); d.Contexts = [c]; }, "contexts[0].properties[1].name");
        Case(d => { var c = Context(); c.KeyPropertyName = ""; d.Contexts = [c]; }, "contexts[0].keyPropertyName");
        Case(d => { var c = Context(); c.KeyPropertyName = "Missing"; d.Contexts = [c]; }, "contexts[0].keyPropertyName");
        Case(d => d.Contexts = Enumerable.Range(0, 51).Select(i => new CatalogContextSchema { Kind = "Context" + i, KeyPropertyName = "Id", Properties = [new() { Name = "Id", Type = "string" }] }).ToList(), "contexts");
        Case(d => d.Contexts = [new() { Kind = "Order", KeyPropertyName = "Id0", Properties = Enumerable.Range(0, 101).Select(i => new CatalogContextProperty { Name = "Id" + i, Type = "string" }).ToList() }], "contexts[0].properties");
        return data;
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
