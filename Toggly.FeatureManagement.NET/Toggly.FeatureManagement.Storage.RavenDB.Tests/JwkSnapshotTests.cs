using FluentAssertions;
using Toggly.FeatureManagement.Data;
using Xunit;

namespace Toggly.FeatureManagement.Storage.RavenDB.Tests;

public class JwkSnapshotTests
{
    #region Default Value Tests

    [Fact]
    public void Id_HasDefaultEmptyString()
    {
        // Act
        var snapshot = new JwkSnapshot();

        // Assert
        snapshot.Id.Should().Be(string.Empty);
    }

    [Fact]
    public void Jwks_HasDefaultJsonWebKeySet()
    {
        // Act
        var snapshot = new JwkSnapshot();

        // Assert
        snapshot.Jwks.Should().NotBeNull();
        // Note: Keys is null by default in JsonWebKeySet
        snapshot.Jwks.Keys.Should().BeNull();
    }

    [Fact]
    public void Timestamp_HasDefaultZero()
    {
        // Act
        var snapshot = new JwkSnapshot();

        // Assert
        snapshot.Timestamp.Should().Be(0);
    }

    #endregion

    #region Property Tests

    [Fact]
    public void Id_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new JwkSnapshot();

        // Act
        snapshot.Id = "JwkSnapshots/Custom";

        // Assert
        snapshot.Id.Should().Be("JwkSnapshots/Custom");
    }

    [Fact]
    public void Jwks_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new JwkSnapshot();
        var jwks = new JsonWebKeySet
        {
            Keys = new List<JsonWebKey>
            {
                new()
                {
                    Kid = "key-1",
                    Kty = "EC",
                    Crv = "P-256"
                }
            }
        };

        // Act
        snapshot.Jwks = jwks;

        // Assert
        snapshot.Jwks.Keys.Should().HaveCount(1);
        snapshot.Jwks.Keys[0].Kid.Should().Be("key-1");
        snapshot.Jwks.Keys[0].Kty.Should().Be("EC");
    }

    [Fact]
    public void Timestamp_CanBeSetAndRetrieved()
    {
        // Arrange
        var snapshot = new JwkSnapshot();

        // Act
        snapshot.Timestamp = 1700000000L;

        // Assert
        snapshot.Timestamp.Should().Be(1700000000L);
    }

    #endregion

    #region Object Initialization Tests

    [Fact]
    public void ObjectInitializer_SetsAllProperties()
    {
        // Arrange & Act
        var snapshot = new JwkSnapshot
        {
            Id = "JwkSnapshots/Test",
            Jwks = new JsonWebKeySet
            {
                Keys = new List<JsonWebKey>
                {
                    new() { Kid = "test-key" }
                }
            },
            Timestamp = 9876543210L
        };

        // Assert
        snapshot.Id.Should().Be("JwkSnapshots/Test");
        snapshot.Jwks.Keys.Should().HaveCount(1);
        snapshot.Jwks.Keys[0].Kid.Should().Be("test-key");
        snapshot.Timestamp.Should().Be(9876543210L);
    }

    [Fact]
    public void Jwks_CanContainMultipleKeys()
    {
        // Arrange & Act
        var snapshot = new JwkSnapshot
        {
            Id = "JwkSnapshots/MultiKey",
            Jwks = new JsonWebKeySet
            {
                Keys = new List<JsonWebKey>
                {
                    new()
                    {
                        Kid = "key-1",
                        Kty = "EC",
                        Crv = "P-256",
                        X = "x-coord-1",
                        Y = "y-coord-1"
                    },
                    new()
                    {
                        Kid = "key-2",
                        Kty = "RSA"
                    },
                    new()
                    {
                        Kid = "key-3",
                        Kty = "EC",
                        Crv = "P-384"
                    }
                }
            },
            Timestamp = 1234567890L
        };

        // Assert
        snapshot.Jwks.Keys.Should().HaveCount(3);
        snapshot.Jwks.Keys[0].Kid.Should().Be("key-1");
        snapshot.Jwks.Keys[0].Kty.Should().Be("EC");
        snapshot.Jwks.Keys[0].Crv.Should().Be("P-256");
        snapshot.Jwks.Keys[1].Kid.Should().Be("key-2");
        snapshot.Jwks.Keys[1].Kty.Should().Be("RSA");
        snapshot.Jwks.Keys[2].Kid.Should().Be("key-3");
        snapshot.Jwks.Keys[2].Crv.Should().Be("P-384");
    }

    #endregion
}
