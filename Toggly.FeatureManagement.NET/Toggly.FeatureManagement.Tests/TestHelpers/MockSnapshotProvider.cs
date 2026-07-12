using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Tests.TestHelpers;

/// <summary>
/// Mock snapshot provider for testing.
/// </summary>
public class MockSnapshotProvider : IFeatureSnapshotProvider
{
    private FeatureDefinitionsSnapshot? _snapshot;
    private JsonWebKeySet? _jwks;
    private long? _jwksTimestamp;

    public MockSnapshotProvider(
        List<FeatureDefinitionModel>? features = null,
        string? signature = null,
        string? keyId = null,
        long? timestamp = null)
    {
        if (features != null || signature != null || keyId != null || timestamp != null)
        {
            _snapshot = new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = keyId,
                Timestamp = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            };
        }
    }

    public Task<FeatureDefinitionsSnapshot?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
    {
        return Task.FromResult(_snapshot);
    }

    public Task SaveSnapshotAsync(FeatureDefinitionsSnapshot snapshot, CancellationToken ct = default)
    {
        _snapshot = snapshot;
        return Task.CompletedTask;
    }

    public Task ClearSnapshotAsync(CancellationToken ct = default)
    {
        _snapshot = null;
        return Task.CompletedTask;
    }

    public Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default)
    {
        return Task.FromResult((_jwks, _jwksTimestamp));
    }

    public Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default)
    {
        _jwks = jwks;
        _jwksTimestamp = timestamp;
        return Task.CompletedTask;
    }

    public Task ClearJwkSnapshotAsync(CancellationToken ct = default)
    {
        _jwks = null;
        _jwksTimestamp = null;
        return Task.CompletedTask;
    }

    /// <summary>
    /// Sets the features to return from GetFeaturesSnapshotAsync.
    /// </summary>
    public void SetFeatures(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null)
    {
        _snapshot = new FeatureDefinitionsSnapshot
        {
            Features = features,
            Signature = signature,
            KeyId = keyId,
            Timestamp = timestamp
        };
    }

    /// <summary>
    /// Sets the JWKS to return from GetJwkSnapshotAsync.
    /// </summary>
    public void SetJwks(JsonWebKeySet jwks, long timestamp)
    {
        _jwks = jwks;
        _jwksTimestamp = timestamp;
    }
}
