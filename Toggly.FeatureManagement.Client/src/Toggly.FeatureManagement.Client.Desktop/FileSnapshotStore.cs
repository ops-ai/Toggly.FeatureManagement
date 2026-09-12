using System.Text.Json;
namespace Toggly.FeatureManagement.Client.Desktop;

/// <summary>Atomic, context-scoped envelopes. Restrict directory access to the current OS user.</summary>
public sealed class FileSnapshotStore(string directory) : ISnapshotStore
{
    private readonly string directory=Path.GetFullPath(directory);
    private string FilePath(string key)
    {
        if(key.Length!=64 || key.Any(c=>!Uri.IsHexDigit(c))) throw new ArgumentException("Expected SHA256 context key.",nameof(key));
        return Path.Combine(directory,key+".json");
    }
    public async ValueTask<ClientSnapshot?> LoadAsync(string contextKey,CancellationToken cancellationToken=default)
    {
        var path=FilePath(contextKey);
        try { return JsonSerializer.Deserialize<ClientSnapshot>(await File.ReadAllTextAsync(path,cancellationToken).ConfigureAwait(false)); }
        catch(FileNotFoundException) { return null; }
        catch(DirectoryNotFoundException) { return null; }
    }
    public async ValueTask SaveAsync(string contextKey,ClientSnapshot snapshot,CancellationToken cancellationToken=default)
    {
        var path=FilePath(contextKey); Directory.CreateDirectory(directory);
        var temporary=path+"."+Guid.NewGuid().ToString("N")+".tmp";
        try { await File.WriteAllTextAsync(temporary,JsonSerializer.Serialize(snapshot),cancellationToken).ConfigureAwait(false); File.Move(temporary,path,true); }
        finally { if(File.Exists(temporary)) File.Delete(temporary); }
    }
}
