namespace Toggly.FeatureManagement.Client;

public enum Requirement { All, Any }
public sealed record EvaluationContext(string? Identity = null, IReadOnlyList<string>? Groups = null, IReadOnlyDictionary<string,string>? Claims = null);
public sealed record EntityContext(string Kind, string Key, IReadOnlyDictionary<string,object?> Attributes);
public sealed record ClientSnapshot(string ContextKey, string Envelope, string? Revision);
public interface ISnapshotStore
{
    ValueTask<ClientSnapshot?> LoadAsync(string contextKey, CancellationToken cancellationToken = default);
    ValueTask SaveAsync(string contextKey, ClientSnapshot snapshot, CancellationToken cancellationToken = default);
}
/// <summary>Host cryptography boundary. Implementations must validate ES256 JWK fingerprint and exact signed bytes.</summary>
public interface ISignatureVerifier
{
    ValueTask<bool> VerifyAsync(string definitionsJson, long timestamp, string signature, string keyId, string jwksJson, CancellationToken cancellationToken = default);
}
public interface IUpdateSource
{
    IAsyncEnumerable<string> ListenAsync(Uri uri, CancellationToken cancellationToken = default);
}
public sealed record TogglyClientOptions
{
    public string? AppKey { get; init; }
    public string Environment { get; init; } = "Production";
    public Uri BaseUri { get; init; } = new("https://definitions.toggly.io/");
    public Uri WebSocketBaseUri { get; init; } = new("wss://definitions.toggly.io/");
    public EvaluationContext Context { get; init; } = new();
    public IReadOnlyDictionary<string,bool> Defaults { get; init; } = new Dictionary<string,bool>();
    public IReadOnlyDictionary<string,Func<bool>> LocalGates { get; init; } = new Dictionary<string,Func<bool>>();
    public IReadOnlyList<string> AllowedKeyIds { get; init; } = [];
    /// <summary>Optional out-of-band trusted keys, enabling verification of persisted envelopes during offline startup.</summary>
    public string? TrustedJwks { get; init; }
    public TimeSpan MaximumSignatureAge { get; init; } = TimeSpan.FromDays(30);
    public TimeSpan RefreshInterval { get; init; } = TimeSpan.FromMinutes(5);
    public bool EnableLiveUpdates { get; init; } = true;
}
