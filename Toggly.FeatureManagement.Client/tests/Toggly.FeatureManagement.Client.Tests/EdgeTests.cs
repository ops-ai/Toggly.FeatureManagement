using System.Net;
using System.Security.Cryptography;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using Xunit;
namespace ClientTests;
public class EdgeTests {
 [Fact] public async Task AllAnyDefaultsAndThrowingPrerequisites() {
  using var http=new HttpClient();await using var client=new TogglyClient(new(){Defaults=new Dictionary<string,bool>{{"on",true},{"blocked",true}},LocalGates=new Dictionary<string,Func<bool>>{{"blocked",()=>throw new InvalidOperationException("device unavailable")}}},http,new Es256SignatureVerifier());
  var errors=0;client.Error+=(_,_)=>errors++;await Task.WhenAll(client.InitializeAsync(),client.InitializeAsync());Assert.True(client.Evaluate([]));Assert.False(client.Evaluate([],negate:true));Assert.True(client.Evaluate(["missing","on"],Requirement.Any));Assert.False(client.Evaluate(["missing","on"]));Assert.True(client.IsEnabled("on"));Assert.False(client.IsEnabled("blocked"));Assert.Equal(1,errors);
 }
 [Fact] public void InvalidConfigurationIsRejected() {
  using var http=new HttpClient();var verifier=new Es256SignatureVerifier();
  foreach(var options in new[]{new TogglyClientOptions{RefreshInterval=TimeSpan.Zero},new(){MaximumSignatureAge=TimeSpan.Zero},new(){BaseUri=new("http://example.com")},new(){WebSocketBaseUri=new("ws://example.com")}}) Assert.Throws<ArgumentException>(()=>new TogglyClient(options,http,verifier));
 }
 [Fact] public async Task MalformedUnsignedBodiesAndDuplicateEnvelopeFieldsNeverApply() {
  using var fixture=new SignedFixture();string body="{}";using var http=new HttpClient(new Handler((r,c)=>Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(body)})));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,EnableLiveUpdates=false},http,new Es256SignatureVerifier());var errors=0;client.Error+=(_,_)=>errors++;
  foreach(var payload in new[]{"{}","{\"on\":true}",fixture.Envelope("{\"on\":42}"),fixture.Envelope("{\"on\":true}").Replace("{\"defs\":","{\"defs\":{},\"defs\":")}){body=payload;await client.RefreshAsync();Assert.False(client.IsEnabled("on"));}Assert.Equal(4,errors);
 }
 [Fact] public async Task SnapshotContextMismatchAndCorruptionCannotLeakOtherUserFlags() {
  using var fixture=new SignedFixture();var store=new CorruptStore(fixture.Envelope("{\"on\":true}"));using var http=new HttpClient(new Handler((r,c)=>throw new HttpRequestException("offline")));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=fixture.Jwks,EnableLiveUpdates=false},http,new Es256SignatureVerifier(),store);await client.InitializeAsync();Assert.False(client.IsEnabled("on"));store.Throw=true;await client.RefreshAsync();Assert.False(client.IsEnabled("on"));
 }
 [Fact] public async Task SigningKeyRotationRecoversWithoutWebSocketNotification() {
  using var oldKey=new SignedFixture();using var newKey=new SignedFixture();var requests=0;
  using var http=new HttpClient(new Handler((r,c)=>{requests++;return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(r.RequestUri!.AbsolutePath.Contains("jwks")?newKey.Jwks:newKey.Envelope("{\"on\":true}"))});}));
  await using var client=new TogglyClient(new(){AppKey="public",TrustedJwks=oldKey.Jwks,EnableLiveUpdates=false},http,new Es256SignatureVerifier());await client.InitializeAsync();Assert.True(client.IsEnabled("on"));Assert.Equal(2,requests);
 }
 [Fact] public async Task DefaultWebSocketConnectionFailuresAreReportedAndDisposed() {
  using var cancellation=new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
  await Assert.ThrowsAnyAsync<Exception>(async()=>{await foreach(var message in new WebSocketUpdates().ListenAsync(new("wss://127.0.0.1:1"),cancellation.Token)){} });
 }
 private sealed class CorruptStore(string envelope) : ISnapshotStore {
  public bool Throw;
  public ValueTask<ClientSnapshot?> LoadAsync(string key,CancellationToken ct=default)=>Throw?throw new System.Text.Json.JsonException("corrupt snapshot"):ValueTask.FromResult<ClientSnapshot?>(new("other-context",envelope,null));
  public ValueTask SaveAsync(string key,ClientSnapshot snapshot,CancellationToken ct=default)=>ValueTask.CompletedTask;
 }
}
