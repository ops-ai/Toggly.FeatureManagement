using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
namespace Toggly.FeatureManagement.Client.Desktop;

public sealed class Es256SignatureVerifier : ISignatureVerifier
{
    public ValueTask<bool> VerifyAsync(string definitionsJson,long timestamp,string signature,string keyId,string jwksJson,CancellationToken cancellationToken=default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            using var doc=JsonDocument.Parse(jwksJson);
            var keys=doc.RootElement.GetProperty("keys").EnumerateArray().Where(k=>k.GetProperty("kid").GetString()==keyId).ToArray();
            if(keys.Length!=1) return ValueTask.FromResult(false);
            var key=keys[0];
            if(key.GetProperty("kty").GetString()!="EC" || key.GetProperty("crv").GetString()!="P-256" || key.GetProperty("alg").GetString()!="ES256") return ValueTask.FromResult(false);
            var x=Decode(key.GetProperty("x").GetString()!); var y=Decode(key.GetProperty("y").GetString()!);
            if(x.Length!=32 || y.Length!=32 || KeyIdentifier(x,y)!=keyId) return ValueTask.FromResult(false);
            using var ecdsa=ECDsa.Create(new ECParameters{Curve=ECCurve.NamedCurves.nistP256,Q=new ECPoint{X=x,Y=y}});
            var digest=SHA256.HashData(SHA256.HashData(Encoding.UTF8.GetBytes(definitionsJson+"|"+timestamp.ToString(System.Globalization.CultureInfo.InvariantCulture))));
            var bytes=Decode(signature);
            return ValueTask.FromResult(ecdsa.VerifyHash(digest,bytes,bytes.Length==64?DSASignatureFormat.IeeeP1363FixedFieldConcatenation:DSASignatureFormat.Rfc3279DerSequence));
        }
        catch(Exception ex) when(ex is JsonException or CryptographicException or FormatException or InvalidOperationException or KeyNotFoundException) { return ValueTask.FromResult(false); }
    }
    [System.Diagnostics.CodeAnalysis.SuppressMessage("Security", "S4790:Using weak hashing algorithms is security-sensitive",
        Justification="Wire-protocol identifier only: canonical signer.ts generateKid requires SHA1(x||y)+ES256. Signature verification uses double SHA256 and ECDSA P-256; this hash does not authenticate data.")]
    private static string KeyIdentifier(byte[] x,byte[] y) => Convert.ToHexString(SHA1.HashData(x.Concat(y).ToArray()))+"ES256";
    private static byte[] Decode(string input) { var value=input.Replace('-','+').Replace('_','/'); return Convert.FromBase64String(value.PadRight((value.Length+3)/4*4,'=')); }
}

public static class DesktopClient
{
    /// <summary>The caller owns and disposes HttpClient after disposing the Toggly client.</summary>
    public static TogglyClient Create(TogglyClientOptions options,HttpClient http,string? snapshotDirectory=null) => new(options,http,new Es256SignatureVerifier(),snapshotDirectory is null?null:new FileSnapshotStore(snapshotDirectory));
}
