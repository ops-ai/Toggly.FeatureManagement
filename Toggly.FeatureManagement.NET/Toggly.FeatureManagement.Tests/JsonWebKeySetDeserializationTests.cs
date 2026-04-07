using FluentAssertions;
using System.Text.Json;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

/// <summary>
/// JWKS from definitions.toggly.io uses RFC 7517 lowercase names; STJ default binding is case-sensitive.
/// </summary>
public class JsonWebKeySetDeserializationTests
{
    [Fact]
    public void Deserialize_LowercaseRfcPropertyNames_PopulatesKeysWhenCaseInsensitive()
    {
        var json = """
            {
              "keys": [
                {
                  "kty": "EC",
                  "crv": "P-256",
                  "x": "testX",
                  "y": "testY",
                  "kid": "computedKidES256",
                  "alg": "ES256"
                }
              ]
            }
            """;

        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var jwks = JsonSerializer.Deserialize<JsonWebKeySet>(json, options);

        jwks.Should().NotBeNull();
        jwks!.Keys.Should().NotBeNull().And.HaveCount(1);
        jwks.Keys![0].Kty.Should().Be("EC");
        jwks.Keys[0].Kid.Should().Be("computedKidES256");
        jwks.Keys[0].Alg.Should().Be("ES256");
        jwks.Keys[0].X.Should().Be("testX");
        jwks.Keys[0].Y.Should().Be("testY");
    }

    [Fact]
    public void Deserialize_LowercaseRfcPropertyNames_LeavesKeysNullWhenCaseSensitive()
    {
        var json = """{"keys":[{"kty":"EC","kid":"k1","alg":"ES256","x":"a","y":"b"}]}""";

        var jwks = JsonSerializer.Deserialize<JsonWebKeySet>(json);

        jwks.Should().NotBeNull();
        jwks!.Keys.Should().BeNull();
    }
}
