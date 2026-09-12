using System.Net;
using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading.Channels;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using Xunit;
namespace ClientTests;
internal sealed class Updates : IUpdateSource {
 public readonly Channel<string> Messages=Channel.CreateUnbounded<string>(); public Uri? Uri;
 public async IAsyncEnumerable<string> ListenAsync(Uri uri,[EnumeratorCancellation] CancellationToken cancellationToken=default) {Uri=uri; await foreach(var message in Messages.Reader.ReadAllAsync(cancellationToken))yield return message;}
}
public class LiveUpdateTests {
 [Fact] public async Task DebouncesUpdatesRefreshesSigningKeysAndIgnoresLegacyPayloads() {
  using var fixture=new SignedFixture();var updates=new Updates(); var calls=0;var keys=0;
  using var http=new HttpClient(new Handler((request,ct)=> {if(request.RequestUri!.AbsolutePath.Contains("jwks")){Interlocked.Increment(ref keys);return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Jwks)});}Interlocked.Increment(ref calls);var response=new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope("{\"on\":true}"))};response.Headers.TryAddWithoutValidation("ETag","\"v1\"");return Task.FromResult(response);}));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,RefreshInterval=TimeSpan.FromHours(1)},http,new Es256SignatureVerifier(),updates:updates);
  await client.InitializeAsync();Assert.Contains("sdk=dotnet-client",updates.Uri!.Query);
  foreach(var message in new[]{"{\"type\":\"evaluated\",\"defs\":{\"on\":false}}","{\"type\":\"sync\",\"unchanged\":true}","{\"type\":\"flags-updated\",\"etag\":\"\\\"v1\\\"\"}"}) await updates.Messages.Writer.WriteAsync(message);
  await Task.Delay(400); Assert.Equal(1,calls);
  for(var i=0;i<4;i++) await updates.Messages.Writer.WriteAsync("{\"type\":\"flags-updated\",\"etag\":\"v2\"}");
  await WaitUntil(()=>calls==2);Assert.True(client.IsEnabled("on"));
  await updates.Messages.Writer.WriteAsync("invalid");await updates.Messages.Writer.WriteAsync("{\"type\":\"signing-key-updated\"}");await WaitUntil(()=>keys==1&&calls==3);
 }
 [Theory]
 [InlineData("update")]
 [InlineData("flags-updated")]
 [InlineData("{\"type\":\"update\"}")]
 [InlineData("{\"type\":\"flags-updated\"}")]
 public async Task NotificationsWithoutRevisionBypassConditionalCache(string notification) {
  using var fixture=new SignedFixture();var updates=new Updates();var calls=0;
  var refreshed=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  using var http=new HttpClient(new Handler((request,ct)=> {
   var call=Interlocked.Increment(ref calls);
   if(call>1) {Assert.False(request.Headers.Contains("If-None-Match"));refreshed.TrySetResult();}
   var response=new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope(call==1?"{\"on\":false}":"{\"on\":true}"))};
   response.Headers.TryAddWithoutValidation("ETag","\"v1\"");return Task.FromResult(response);
  }));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,RefreshInterval=TimeSpan.FromHours(1)},http,new Es256SignatureVerifier(),updates:updates);
  await client.InitializeAsync();await updates.Messages.Writer.WriteAsync(notification);
  await refreshed.Task.WaitAsync(TimeSpan.FromSeconds(3));await WaitUntil(()=>client.IsEnabled("on"));
 }
 [Fact] public async Task RevisionNotificationPinsFetchUntilHttpConfirmsIt() {
  using var fixture=new SignedFixture();var updates=new Updates();var requests=new List<(string Query,bool Conditional)>();
  using var http=new HttpClient(new Handler((request,ct)=> {
   requests.Add((request.RequestUri!.Query,request.Headers.Contains("If-None-Match")));
   var response=new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope("{}"))};
   response.Headers.TryAddWithoutValidation("ETag",requests.Count==1?"\"v1\"":"\"v2\"");return Task.FromResult(response);
  }));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,RefreshInterval=TimeSpan.FromHours(1)},http,new Es256SignatureVerifier(),updates:updates);
  await client.InitializeAsync();await updates.Messages.Writer.WriteAsync("{\"type\":\"flags-updated\",\"etag\":\"v2\"}");
  await WaitUntil(()=>requests.Count==2);Assert.Contains("rev=v2",requests[1].Query);Assert.False(requests[1].Conditional);
 }
 [Fact] public async Task NewNotificationCancelsAndDrainsTheSupersededRefresh() {
  using var fixture=new SignedFixture();var updates=new Updates();var calls=0;
  var started=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  var cancelled=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  using var http=new HttpClient(new Handler(async (request,ct)=> {
   var call=Interlocked.Increment(ref calls);
   if(call==2) {using var registration=ct.Register(()=>cancelled.TrySetResult());started.TrySetResult();await release.Task;}
   return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope(call==3?"{\"on\":true}":"{\"on\":false}"))};
  }));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,RefreshInterval=TimeSpan.FromHours(1)},http,new Es256SignatureVerifier(),updates:updates);
  await client.InitializeAsync();await updates.Messages.Writer.WriteAsync("update");await started.Task.WaitAsync(TimeSpan.FromSeconds(3));
  await updates.Messages.Writer.WriteAsync("flags-updated");await cancelled.Task.WaitAsync(TimeSpan.FromSeconds(3));
  Assert.Equal(2,calls);Assert.False(client.IsEnabled("on"));release.TrySetResult();await WaitUntil(()=>client.IsEnabled("on"));Assert.Equal(3,calls);
 }
 [Fact] public async Task DisposalDrainsRefreshEvenWhenTransportDelaysCancellation() {
  using var fixture=new SignedFixture();var started=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  using var http=new HttpClient(new Handler(async (request,ct)=> {started.SetResult();await release.Task;return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope("{}"))};}));
  var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,EnableLiveUpdates=false},http,new Es256SignatureVerifier());
  var refresh=client.RefreshAsync();await started.Task;var disposal=client.DisposeAsync().AsTask();Assert.False(disposal.IsCompleted);
  release.SetResult();await Assert.ThrowsAnyAsync<OperationCanceledException>(()=>refresh);await disposal.WaitAsync(TimeSpan.FromSeconds(3));
 }
 [Fact] public async Task SubscriberFailuresDoNotSkipLaterHandlersAndHandlersCanBeRemoved() {
  using var fixture=new SignedFixture();using var http=new HttpClient(new Handler((r,c)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope("{}"))})));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,EnableLiveUpdates=false},http,new Es256SignatureVerifier());
  var changes=0;var errors=0;
  EventHandler throwingChange=(_,_)=>throw new InvalidOperationException("consumer");
  EventHandler change=(_,_)=>changes++;
  EventHandler<Exception> throwingError=(_,_)=>throw new InvalidOperationException("error consumer");
  EventHandler<Exception> error=(_,_)=>errors++;
  client.Changed+=throwingChange;client.Changed+=change;client.Error+=throwingError;client.Error+=error;
  await client.InitializeAsync();Assert.Equal(1,changes);Assert.Equal(1,errors);
  client.Changed-=throwingChange;client.Changed-=change;client.Error-=throwingError;client.Error-=error;
  await client.RefreshAsync();Assert.Equal(1,changes);Assert.Equal(1,errors);
 }
 [Fact] public async Task PollingContinuesWithoutLiveUpdatesAndDisposalStopsIt() {
  using var fixture=new SignedFixture();var calls=0;using var http=new HttpClient(new Handler((r,c)=>{Interlocked.Increment(ref calls);return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(fixture.Envelope("{}"))});}));
  var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,EnableLiveUpdates=false,RefreshInterval=TimeSpan.FromMilliseconds(30)},http,new Es256SignatureVerifier());
  await client.InitializeAsync();await WaitUntil(()=>calls>=2);await client.DisposeAsync();var stopped=calls;await Task.Delay(80);Assert.Equal(stopped,calls);
 }
 private static async Task WaitUntil(Func<bool> condition) {using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(5));while(!condition())await Task.Delay(10,timeout.Token);}
 [Fact] public async Task WebSocketFramesAreCombinedAndConnectionIsDisposed() {
  var socket=new FakeSocket([(Encoding.UTF8.GetBytes("{\"type\":"),false,WebSocketMessageType.Text),(Encoding.UTF8.GetBytes("\"sync\"}"),true,WebSocketMessageType.Text),([],true,WebSocketMessageType.Close)]);
  var source=new WebSocketUpdates((uri,ct)=>Task.FromResult<WebSocket>(socket));var messages=new List<string>();await foreach(var message in source.ListenAsync(new("wss://example.com")))messages.Add(message);Assert.Equal("{\"type\":\"sync\"}",Assert.Single(messages));Assert.True(socket.Disposed);
 }
 [Theory][InlineData(true)][InlineData(false)] public async Task InvalidOrOversizedWebSocketFramesAreRejected(bool binary) {
  var frames=binary?new[]{(new byte[1],true,WebSocketMessageType.Binary)}:Enumerable.Range(0,9).Select(_=>(new byte[8192],false,WebSocketMessageType.Text)).ToArray();var socket=new FakeSocket(frames);var source=new WebSocketUpdates((uri,ct)=>Task.FromResult<WebSocket>(socket));
  await Assert.ThrowsAsync<WebSocketException>(async()=>{await foreach(var message in source.ListenAsync(new("wss://example.com"))){} });Assert.True(socket.Disposed);
 }
}
internal sealed class FakeSocket(IEnumerable<(byte[] Data,bool End,WebSocketMessageType Type)> frames) : WebSocket {
 private readonly Queue<(byte[] Data,bool End,WebSocketMessageType Type)> queue=new(frames);public bool Disposed;
 public override WebSocketCloseStatus? CloseStatus=>null;public override string? CloseStatusDescription=>null;public override WebSocketState State=>WebSocketState.Open;public override string? SubProtocol=>null;
 public override void Abort(){} public override Task CloseAsync(WebSocketCloseStatus status,string? description,CancellationToken ct)=>Task.CompletedTask;public override Task CloseOutputAsync(WebSocketCloseStatus status,string? description,CancellationToken ct)=>Task.CompletedTask;public override void Dispose()=>Disposed=true;
 public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer,CancellationToken ct) {var frame=queue.Dequeue();frame.Data.CopyTo(buffer.Array!,buffer.Offset);return Task.FromResult(new WebSocketReceiveResult(frame.Data.Length,frame.Type,frame.End));}
 public override Task SendAsync(ArraySegment<byte> buffer,WebSocketMessageType type,bool end,CancellationToken ct)=>Task.CompletedTask;
}
