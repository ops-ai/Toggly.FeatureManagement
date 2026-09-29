// SYSLIB1054: Security.framework P/Invoke signatures (byte[] password blobs / CF types) are
// kept as DllImport for AOT-safe Keychain interop; LibraryImport marshalling is not a fit here.
#pragma warning disable SYSLIB1054

using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// macOS Keychain store for CLI auth sessions (Security.framework).
/// </summary>
[SupportedOSPlatform("macos")]
[ExcludeFromCodeCoverage(Justification = "Thin P/Invoke wrapper over macOS Keychain; exercised by OS-gated integration tests.")]
internal sealed class MacOSKeychainStore : ISecureTokenStore
{
    private static readonly byte[] ServiceNameBytes = Encoding.UTF8.GetBytes(Constants.CredentialServiceName);
    private static readonly byte[] AccountNameBytes = Encoding.UTF8.GetBytes(Constants.CredentialAccountName);

    public Task SaveAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = AuthSessionCodec.EncodeUtf8(session);

        // Replace existing item if present.
        DeleteInternal();

        var status = SecKeychainAddGenericPassword(
            IntPtr.Zero,
            (uint)ServiceNameBytes.Length,
            ServiceNameBytes,
            (uint)AccountNameBytes.Length,
            AccountNameBytes,
            (uint)payload.Length,
            payload,
            out var itemRef);

        try
        {
            if (status != errSecSuccess)
                throw new InvalidOperationException($"Failed to save auth session to macOS Keychain (status {status}).");
        }
        finally
        {
            if (itemRef != IntPtr.Zero)
                CFRelease(itemRef);
        }

        return Task.CompletedTask;
    }

    public Task<AuthSession?> LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var status = SecKeychainFindGenericPassword(
            IntPtr.Zero,
            (uint)ServiceNameBytes.Length,
            ServiceNameBytes,
            (uint)AccountNameBytes.Length,
            AccountNameBytes,
            out var passwordLength,
            out var passwordData,
            out var itemRef);

        if (status == errSecItemNotFound)
            return Task.FromResult<AuthSession?>(null);

        if (status != errSecSuccess)
            throw new InvalidOperationException($"Failed to load auth session from macOS Keychain (status {status}).");

        try
        {
            if (passwordData == IntPtr.Zero || passwordLength == 0)
                return Task.FromResult<AuthSession?>(null);

            var bytes = new byte[passwordLength];
            Marshal.Copy(passwordData, bytes, 0, (int)passwordLength);
            return Task.FromResult(AuthSessionCodec.DecodeUtf8(bytes));
        }
        finally
        {
            if (passwordData != IntPtr.Zero)
                _ = SecKeychainItemFreeContent(IntPtr.Zero, passwordData);
            if (itemRef != IntPtr.Zero)
                CFRelease(itemRef);
        }
    }

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        DeleteInternal();
        return Task.CompletedTask;
    }

    private static void DeleteInternal()
    {
        var status = SecKeychainFindGenericPassword(
            IntPtr.Zero,
            (uint)ServiceNameBytes.Length,
            ServiceNameBytes,
            (uint)AccountNameBytes.Length,
            AccountNameBytes,
            out _,
            out var passwordData,
            out var itemRef);

        if (status == errSecItemNotFound)
            return;

        if (status != errSecSuccess)
            throw new InvalidOperationException($"Failed to locate auth session in macOS Keychain (status {status}).");

        try
        {
            if (passwordData != IntPtr.Zero)
                _ = SecKeychainItemFreeContent(IntPtr.Zero, passwordData);

            if (itemRef != IntPtr.Zero)
            {
                var deleteStatus = SecKeychainItemDelete(itemRef);
                if (deleteStatus != errSecSuccess && deleteStatus != errSecItemNotFound)
                    throw new InvalidOperationException($"Failed to delete auth session from macOS Keychain (status {deleteStatus}).");
            }
        }
        finally
        {
            if (itemRef != IntPtr.Zero)
                CFRelease(itemRef);
        }
    }

    private const int errSecSuccess = 0;
    private const int errSecItemNotFound = -25300;

    [DllImport("/System/Library/Frameworks/Security.framework/Security")]
    private static extern int SecKeychainAddGenericPassword(
        IntPtr keychain,
        uint serviceNameLength,
        byte[] serviceName,
        uint accountNameLength,
        byte[] accountName,
        uint passwordLength,
        byte[] passwordData,
        out IntPtr itemRef);

    [DllImport("/System/Library/Frameworks/Security.framework/Security")]
    private static extern int SecKeychainFindGenericPassword(
        IntPtr keychainOrArray,
        uint serviceNameLength,
        byte[] serviceName,
        uint accountNameLength,
        byte[] accountName,
        out uint passwordLength,
        out IntPtr passwordData,
        out IntPtr itemRef);

    [DllImport("/System/Library/Frameworks/Security.framework/Security")]
    private static extern int SecKeychainItemDelete(IntPtr itemRef);

    [DllImport("/System/Library/Frameworks/Security.framework/Security")]
    private static extern int SecKeychainItemFreeContent(IntPtr attrList, IntPtr data);

    [DllImport("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")]
    private static extern void CFRelease(IntPtr cf);
}
