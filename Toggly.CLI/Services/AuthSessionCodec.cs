using System.Text;
using System.Text.Json;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Serializes <see cref="AuthSession"/> for OS credential-store payloads (AOT-safe).
/// </summary>
public static class AuthSessionCodec
{
    public static string Encode(AuthSession session)
        => JsonSerializer.Serialize(session, TogglyJsonSerializerContext.Default.AuthSession);

    public static byte[] EncodeUtf8(AuthSession session)
        => Encoding.UTF8.GetBytes(Encode(session));

    public static AuthSession? Decode(string json)
        => JsonSerializer.Deserialize(json, TogglyJsonSerializerContext.Default.AuthSession);

    public static AuthSession? DecodeUtf8(ReadOnlySpan<byte> utf8)
        => JsonSerializer.Deserialize(utf8, TogglyJsonSerializerContext.Default.AuthSession);
}
