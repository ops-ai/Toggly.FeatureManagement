using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class EcdsaSignatureTests
{
    [Fact]
    public void Constructor_StoresRAndSValues()
    {
        // Arrange
        var r = new byte[] { 1, 2, 3, 4 };
        var s = new byte[] { 5, 6, 7, 8 };

        // Act
        var signature = new EcdsaSignature(r, s);

        // Assert
        signature.R.Should().BeEquivalentTo(r);
        signature.S.Should().BeEquivalentTo(s);
    }

    [Fact]
    public void ToByteArray_ProducesValidDerEncodedStructure()
    {
        // Arrange
        var r = new byte[] { 0x01, 0x02, 0x03, 0x04 };
        var s = new byte[] { 0x05, 0x06, 0x07, 0x08 };
        var signature = new EcdsaSignature(r, s);

        // Act
        var result = signature.ToByteArray();

        // Assert
        // DER structure: 0x30 (SEQUENCE tag) + length + 0x02 (INTEGER tag) + R length + R + 0x02 + S length + S
        result.Should().NotBeEmpty();
        result[0].Should().Be(0x30); // SEQUENCE tag
        result[2].Should().Be(0x02); // INTEGER tag for R
        result[3].Should().Be((byte)r.Length); // R length
    }

    [Fact]
    public void ToByteArray_WithKnownValues_MatchesExpectedOutput()
    {
        // Arrange
        var r = new byte[] { 0xAB, 0xCD };
        var s = new byte[] { 0x12, 0x34 };
        var signature = new EcdsaSignature(r, s);

        // Act
        var result = signature.ToByteArray();

        // Assert
        // Expected: 0x30, totalLen(8), 0x02, 2, 0xAB, 0xCD, 0x02, 2, 0x12, 0x34
        var expected = new byte[] { 0x30, 0x08, 0x02, 0x02, 0xAB, 0xCD, 0x02, 0x02, 0x12, 0x34 };
        result.Should().BeEquivalentTo(expected);
    }

    [Fact]
    public void ToByteArray_WithEmptyArrays_ProducesMinimalValidStructure()
    {
        // Arrange
        var r = Array.Empty<byte>();
        var s = Array.Empty<byte>();
        var signature = new EcdsaSignature(r, s);

        // Act
        var result = signature.ToByteArray();

        // Assert
        // Expected: 0x30, 4 (total length), 0x02, 0, 0x02, 0
        result.Should().NotBeEmpty();
        result[0].Should().Be(0x30);
        result[1].Should().Be(4); // Total length = 0 + 0 + 4 (tags and lengths)
    }

    [Fact]
    public void ToByteArray_TotalLengthIsCorrect()
    {
        // Arrange
        var r = new byte[] { 1, 2, 3 };
        var s = new byte[] { 4, 5 };
        var signature = new EcdsaSignature(r, s);

        // Act
        var result = signature.ToByteArray();

        // Assert
        // Total length should be R.Length + S.Length + 4 (for the two INTEGER tags and lengths)
        var expectedTotalLength = r.Length + s.Length + 4;
        result[1].Should().Be((byte)expectedTotalLength);
    }
}
