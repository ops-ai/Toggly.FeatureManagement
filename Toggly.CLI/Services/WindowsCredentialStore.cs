using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Windows Credential Manager store for CLI auth sessions.
/// </summary>
[SupportedOSPlatform("windows")]
[ExcludeFromCodeCoverage(Justification = "Thin P/Invoke wrapper over Windows Credential Manager; not exercised on non-Windows CI.")]
internal sealed class WindowsCredentialStore : ISecureTokenStore
{
    private static readonly string TargetName = $"{Constants.CredentialServiceName}:{Constants.CredentialAccountName}";

    public Task SaveAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var blob = AuthSessionCodec.EncodeUtf8(session);
        WriteCredential(blob);
        return Task.CompletedTask;
    }

    public Task<AuthSession?> LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var blob = ReadCredential();
        if (blob is null)
            return Task.FromResult<AuthSession?>(null);

        return Task.FromResult(AuthSessionCodec.DecodeUtf8(blob));
    }

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        CredDeleteW(TargetName, CRED_TYPE_GENERIC, 0);
        return Task.CompletedTask;
    }

    private static void WriteCredential(byte[] blob)
    {
        // Store AuthSession JSON as raw UTF-8 bytes (CRED_TYPE_GENERIC binary blob).
        // Do not re-encode as UTF-16 — that roughly doubles size and can exceed CredMan's limit.
        var credential = new CREDENTIAL
        {
            Type = CRED_TYPE_GENERIC,
            TargetName = TargetName,
            UserName = Constants.CredentialAccountName,
            CredentialBlob = Marshal.AllocHGlobal(blob.Length),
            CredentialBlobSize = blob.Length,
            Persist = CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount = 0,
            Attributes = IntPtr.Zero,
            Comment = IntPtr.Zero,
            TargetAlias = IntPtr.Zero
        };

        try
        {
            Marshal.Copy(blob, 0, credential.CredentialBlob, blob.Length);
            if (!CredWriteW(ref credential, 0))
                throw new InvalidOperationException($"Failed to write Windows credential (error {Marshal.GetLastWin32Error()}).");
        }
        finally
        {
            if (credential.CredentialBlob != IntPtr.Zero)
                Marshal.FreeHGlobal(credential.CredentialBlob);
        }
    }

    private static byte[]? ReadCredential()
    {
        if (!CredReadW(TargetName, CRED_TYPE_GENERIC, 0, out var credPtr))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == ERROR_NOT_FOUND)
                return null;
            throw new InvalidOperationException($"Failed to read Windows credential (error {error}).");
        }

        try
        {
            var credential = Marshal.PtrToStructure<CREDENTIAL>(credPtr);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize <= 0)
                return null;

            var blob = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, blob, 0, credential.CredentialBlobSize);
            return WindowsCredentialBlob.NormalizeUtf8Payload(blob);
        }
        finally
        {
            CredFree(credPtr);
        }
    }

    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;
    private const int ERROR_NOT_FOUND = 1168;

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredReadW(string targetName, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDeleteW(string targetName, int type, int flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr credential);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public int Flags;
        public int Type;
        public string TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public string UserName;
    }
}

/// <summary>
/// Pure helpers for Windows CredMan UTF-8 session blobs (unit-testable without CredMan).
/// </summary>
internal static class WindowsCredentialBlob
{
    /// <summary>
    /// CredMan's documented practical limit for credential blob size (~2560 bytes).
    /// </summary>
    public const int CredManBlobSoftLimitBytes = 2560;

    /// <summary>
    /// Returns the UTF-8 JSON payload for CredWrite, optionally stripping a trailing NUL.
    /// </summary>
    public static byte[] NormalizeUtf8Payload(ReadOnlySpan<byte> blob)
    {
        if (blob.Length > 0 && blob[^1] == 0)
            blob = blob[..^1];

        return blob.ToArray();
    }

    /// <summary>
    /// True when a UTF-8 AuthSession payload fits CredMan without UTF-16 inflation.
    /// </summary>
    public static bool FitsCredManSoftLimit(byte[] utf8Blob)
        => utf8Blob.Length <= CredManBlobSoftLimitBytes;
}
