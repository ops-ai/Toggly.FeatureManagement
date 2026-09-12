using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
namespace Toggly.FeatureManagement.Client;

public sealed class WebSocketUpdates(Func<Uri,CancellationToken,Task<WebSocket>>? connect = null) : IUpdateSource
{
    private static async Task<WebSocket> ConnectAsync(Uri uri,CancellationToken ct)
    {
        var socket=new ClientWebSocket();
        try { await socket.ConnectAsync(uri,ct).ConfigureAwait(false); return socket; }
        catch { socket.Dispose(); throw; }
    }
    public async IAsyncEnumerable<string> ListenAsync(Uri uri,[EnumeratorCancellation] CancellationToken cancellationToken=default)
    {
        using var socket=await (connect ?? ConnectAsync)(uri,cancellationToken).ConfigureAwait(false);
        var buffer=new byte[8192];
        using var message=new MemoryStream();
        while(socket.State==WebSocketState.Open)
        {
            var result=await socket.ReceiveAsync(buffer.AsMemory(),cancellationToken).ConfigureAwait(false);
            if(result.MessageType==WebSocketMessageType.Close) yield break;
            if(result.MessageType!=WebSocketMessageType.Text) throw new WebSocketException("Expected text updates.");
            message.Write(buffer,0,result.Count);
            if(message.Length>65536) throw new WebSocketException("Update too large.");
            if(!result.EndOfMessage) continue;
            yield return Encoding.UTF8.GetString(message.ToArray()); message.SetLength(0);
        }
    }
}
