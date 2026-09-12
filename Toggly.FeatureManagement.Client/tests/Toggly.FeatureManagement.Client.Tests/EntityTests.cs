using Xunit;
using System.Text.Json;
using Toggly.FeatureManagement.Client;
namespace ClientTests;
public class EntityTests {
 private static readonly string[] Tags = ["VIP","new"];
 [Theory]
 [InlineData("eq","string","Alice","alice",true)] [InlineData("neq","string","Alice","bob",true)]
 [InlineData("in","string","Alice"," bob,alice, ",true)] [InlineData("contains","string","Alphabet","pha",true)]
 [InlineData("gt","number","10","2",true)] [InlineData("gte","number","2","2",true)] [InlineData("lt","number","1","2",true)] [InlineData("lte","number","2","2",true)]
 [InlineData("gt","datetime","2026-01-01","2020-01-01",true)] [InlineData("gt","datetime","bad","2020-01-01",false)]
 [InlineData("gt","string","4","2",false)] [InlineData("gt","number","NaN","2",false)] [InlineData("gt","number","2","NaN",false)]
 [InlineData("gt","number","bad","2",false)] [InlineData("gt","number","2","bad",false)] [InlineData("unknown","number","2","3",false)]
 public void NativeEntityOperators(string op,string type,string actual,string expected,bool result) {
  using var doc=JsonDocument.Parse(JsonSerializer.Serialize(new{requirement="all",rules=new[]{new{property="VALUE",op,type,value=expected}}}));
  Assert.Equal(result,EntityEvaluator.Resolve(doc.RootElement,new("Order","one",new Dictionary<string,object?>{{"value",actual}})));
 }
 [Fact] public void ArraysAnyMissingAndMalformedFailClosed() {
  var entity=new EntityContext("Order","one",new Dictionary<string,object?>{{"tags",Tags}});
  using var doc=JsonDocument.Parse("{\"requirement\":\"any\",\"rules\":[{\"property\":\"missing\",\"op\":\"eq\",\"value\":\"x\"},{\"property\":\"tags\",\"op\":\"contains\",\"type\":\"string[]\",\"value\":\"vip\"}]}");
  Assert.True(EntityEvaluator.Resolve(doc.RootElement,entity)); Assert.False(EntityEvaluator.Resolve(doc.RootElement));
  foreach(var raw in new[]{"false","null","{}","{\"rules\":[]}","{\"rules\":[{}]}","{\"requirement\":\"invalid\",\"rules\":[{}]}"}) {using var invalid=JsonDocument.Parse(raw);Assert.False(EntityEvaluator.Resolve(invalid.RootElement,entity));}
 }
}
