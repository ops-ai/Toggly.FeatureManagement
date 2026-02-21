using Toggly.FeatureManagement.Data;

namespace Toggly.FeatureManagement.Tests.TestHelpers;

/// <summary>
/// Mock snapshot provider for testing.
/// </summary>
public class MockSnapshotProvider : IFeatureSnapshotProvider
{
    private List<FeatureDefinitionModel>? _features;
    private string? _signature;
    private string? _keyId;
    private long? _timestamp;
    private JsonWebKeySet? _jwks;
    private long? _jwksTimestamp;

    public MockSnapshotProvider(
        List<FeatureDefinitionModel>? features = null,
        string? signature = null,
        string? keyId = null,
        long? timestamp = null)
    {
        _features = features;
        _signature = signature;
        _keyId = keyId;
        _timestamp = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
    }

    public Task<(List<FeatureDefinitionModel>? Features, string? Signature, string? KeyId, long? Timestamp)> GetFeaturesSnapshotAsync(CancellationToken ct = default)
    {
        return Task.FromResult((_features, _signature, _keyId, _timestamp));
    }

    public Task SaveSnapshotAsync(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null, CancellationToken ct = default)
    {
        _features = features;
        _signature = signature;
        _keyId = keyId;
        _timestamp = timestamp;
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

    /// <summary>
    /// Sets the features to return from GetFeaturesSnapshotAsync.
    /// </summary>
    public void SetFeatures(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null)
    {
        _features = features;
        _signature = signature;
        _keyId = keyId;
        _timestamp = timestamp;
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
