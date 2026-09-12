namespace Toggly.FeatureManagement.Client;

/// <summary>How a collection of feature keys is combined.</summary>
public enum Requirement
{
    All,
    Any
}
/// <summary>User targeting sent to evaluated delivery. Use a separate client for each independent session.</summary>
public sealed record EvaluationContext(string? Identity = null, IReadOnlyList<string>? Groups = null, IReadOnlyDictionary<string, string>? Claims = null);
/// <summary>Per-read entity attributes for signed entity rules; these are never persisted as evaluated decisions.</summary>
public sealed record EntityContext(string Kind, string Key, IReadOnlyDictionary<string, object?> Attributes);
/// <summary>A context-scoped signed response and the public keys needed to reverify it after restart.</summary>
/// <remarks>Storage must be protected by the host. Pin trusted keys or allowed key identifiers when local storage is not trusted.</remarks>
public sealed record ClientSnapshot(string ContextKey, string Envelope, string? Revision)
{

    /// <summary>Version 1 contains a legacy envelope; version 2 also retains its accepted verification keys.</summary>
    public int FormatVersion { get; init; } = 1;

    /// <summary>The exact public key set that verified this envelope. This is not a secret or an independent trust anchor.</summary>
    public string? TrustedJwks
    {
        get; init;
    }
}
/// <summary>Host-owned persistence. Implementations must round-trip the complete versioned snapshot and isolate context keys.</summary>
public interface ISnapshotStore
{

    /// <summary>Read one context without contacting the definitions service.</summary>
    ValueTask<ClientSnapshot?> LoadAsync(string contextKey, CancellationToken cancellationToken = default);

    /// <summary>Atomically persist the complete signed snapshot for the supplied context.</summary>
    ValueTask SaveAsync(string contextKey, ClientSnapshot snapshot, CancellationToken cancellationToken = default);
}
/// <summary>Host cryptography boundary. Implementations must validate ES256 JWK fingerprint and exact signed bytes.</summary>
public interface ISignatureVerifier
{
    ValueTask<bool> VerifyAsync(string definitionsJson, long timestamp, string signature, string keyId, string jwksJson, CancellationToken cancellationToken = default);
}
/// <summary>Host transport for invalidation messages. Payloads never directly replace signed definitions.</summary>
public interface IUpdateSource
{
    IAsyncEnumerable<string> ListenAsync(Uri uri, CancellationToken cancellationToken = default);
}
/// <summary>Configuration for a frontend session with mandatory signature verification.</summary>
public sealed record TogglyClientOptions
{

    /// <summary>Public frontend application key; empty selects local defaults without network access.</summary>
    public string? AppKey
    {
        get; init;
    }

    /// <summary>Definitions environment, also included in cache partitioning.</summary>
    public string Environment { get; init; } = "Production";

    /// <summary>Trusted HTTPS base for evaluated-signed definitions and public verification keys.</summary>
    public Uri BaseUri { get; init; } = new("https://definitions.toggly.io/");

    /// <summary>Secure WebSocket base used for live invalidations.</summary>
    public Uri WebSocketBaseUri { get; init; } = new("wss://definitions.toggly.io/");

    /// <summary>Initial user context. SetContextAsync changes it while invalidating old in-flight responses.</summary>
    public EvaluationContext Context { get; init; } = new();

    /// <summary>Fallback values used before verified definitions are available.</summary>
    public IReadOnlyDictionary<string, bool> Defaults { get; init; } = new Dictionary<string, bool>();

    /// <summary>Device-local prerequisites that may restrict, but never enable, a remotely disabled feature.</summary>
    public IReadOnlyDictionary<string, Func<bool>> LocalGates { get; init; } = new Dictionary<string, Func<bool>>();

    /// <summary>Optional independently trusted signing-key identifiers, enforced for network and offline acceptance.</summary>
    public IReadOnlyList<string> AllowedKeyIds { get; init; } = [];

    /// <summary>Optional authoritative trusted keys. When supplied, endpoint or persisted keys cannot override this set.</summary>
    public string? TrustedJwks
    {
        get; init;
    }

    /// <summary>Maximum age at envelope acceptance, including restart. Existing memory state remains last-known-good.</summary>
    public TimeSpan MaximumSignatureAge { get; init; } = TimeSpan.FromDays(30);

    /// <summary>Polling interval used to recover when live invalidations are unavailable.</summary>
    public TimeSpan RefreshInterval { get; init; } = TimeSpan.FromMinutes(5);

    /// <summary>Whether to maintain a reconnecting WebSocket listener alongside polling.</summary>
    public bool EnableLiveUpdates { get; init; } = true;
}
