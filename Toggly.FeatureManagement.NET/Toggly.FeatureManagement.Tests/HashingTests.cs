using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class HashingTests
{
    [Fact]
    public void GetStringSha256Hash_WithKnownInput_ProducesExpectedHash()
    {
        // Arrange
        const string input = "hello";
        // SHA256 of "hello" is known to be:
        const string expectedHash = "2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824";

        // Act
        var result = Hashing.GetStringSha256Hash(input);

        // Assert
        result.Should().Be(expectedHash);
    }

    [Fact]
    public void GetStringSha256Hash_WithEmptyString_ReturnsEmptyString()
    {
        // Act
        var result = Hashing.GetStringSha256Hash(string.Empty);

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public void GetStringSha256Hash_WithNullString_ReturnsEmptyString()
    {
        // Act
        var result = Hashing.GetStringSha256Hash(null!);

        // Assert
        result.Should().BeEmpty();
    }

    [Fact]
    public void GetStringSha256Hash_IsDeterministic()
    {
        // Arrange
        const string input = "test-input-string";

        // Act
        var result1 = Hashing.GetStringSha256Hash(input);
        var result2 = Hashing.GetStringSha256Hash(input);

        // Assert
        result1.Should().Be(result2);
    }

    [Fact]
    public void GetStringSha256Hash_DifferentInputs_ProduceDifferentHashes()
    {
        // Arrange
        const string input1 = "input1";
        const string input2 = "input2";

        // Act
        var result1 = Hashing.GetStringSha256Hash(input1);
        var result2 = Hashing.GetStringSha256Hash(input2);

        // Assert
        result1.Should().NotBe(result2);
    }

    [Fact]
    public void GetStringSha256Hash_ReturnsUppercaseHex()
    {
        // Arrange
        const string input = "test";

        // Act
        var result = Hashing.GetStringSha256Hash(input);

        // Assert
        result.Should().MatchRegex("^[A-F0-9]+$");
    }

    [Fact]
    public void GetStringSha256Hash_Returns64Characters()
    {
        // Arrange
        const string input = "any input string";

        // Act
        var result = Hashing.GetStringSha256Hash(input);

        // Assert
        // SHA256 produces 32 bytes = 64 hex characters
        result.Should().HaveLength(64);
    }
}
