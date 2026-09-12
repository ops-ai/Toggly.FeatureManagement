namespace Toggly.FeatureManagement.Embedded;

public enum EmbeddedStorageState { Uninitialized, Available, Stale, Unavailable }

public sealed class EmbeddedRuntimeDiagnostics
{
    public string? ActiveRevision { get; internal set; }
    public DateTimeOffset? LastSuccessfulRefreshUtc { get; internal set; }
    public EmbeddedStorageState StorageState { get; internal set; } = EmbeddedStorageState.Uninitialized;
    public bool ReadOnly { get; internal set; }
    public bool IsWriter { get; internal set; }
    public string? LastError { get; internal set; }
}
