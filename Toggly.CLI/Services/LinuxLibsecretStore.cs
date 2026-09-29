using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Linux libsecret store for CLI auth sessions. Fails clearly if libsecret is unavailable.
/// </summary>
[SupportedOSPlatform("linux")]
[ExcludeFromCodeCoverage(Justification = "Thin P/Invoke wrapper over libsecret; unavailable on headless CI without keyring.")]
internal sealed class LinuxLibsecretStore : ISecureTokenStore
{
    private const string SchemaName = "io.toggly.cli.AuthSession";

    public Task SaveAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureLibsecretAvailable();

        var payload = AuthSessionCodec.Encode(session);
        return Task.FromResult(WithSchema(schema =>
        {
            var error = IntPtr.Zero;
            var ok = secret_password_store_sync(
                schema,
                SECRET_COLLECTION_DEFAULT,
                $"{Constants.CredentialServiceName} auth session",
                payload,
                IntPtr.Zero,
                ref error,
                "service", Constants.CredentialServiceName,
                "account", Constants.CredentialAccountName,
                IntPtr.Zero);

            if (error != IntPtr.Zero)
            {
                var message = GErrorMessage(error);
                g_error_free(error);
                throw new InvalidOperationException($"Failed to save auth session to libsecret: {message}");
            }

            if (!ok)
                throw new InvalidOperationException("Failed to save auth session to libsecret.");

            return true;
        }));
    }

    public Task<AuthSession?> LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureLibsecretAvailable();

        return Task.FromResult(WithSchema(schema =>
        {
            var error = IntPtr.Zero;
            var passwordPtr = secret_password_lookup_sync(
                schema,
                IntPtr.Zero,
                ref error,
                "service", Constants.CredentialServiceName,
                "account", Constants.CredentialAccountName,
                IntPtr.Zero);

            if (error != IntPtr.Zero)
            {
                var message = GErrorMessage(error);
                g_error_free(error);
                throw new InvalidOperationException($"Failed to load auth session from libsecret: {message}");
            }

            if (passwordPtr == IntPtr.Zero)
                return null;

            try
            {
                var json = Marshal.PtrToStringUTF8(passwordPtr);
                return string.IsNullOrEmpty(json) ? null : AuthSessionCodec.Decode(json);
            }
            finally
            {
                secret_password_free(passwordPtr);
            }
        }));
    }

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        EnsureLibsecretAvailable();

        WithSchema(schema =>
        {
            var error = IntPtr.Zero;
            secret_password_clear_sync(
                schema,
                IntPtr.Zero,
                ref error,
                "service", Constants.CredentialServiceName,
                "account", Constants.CredentialAccountName,
                IntPtr.Zero);

            if (error != IntPtr.Zero)
            {
                var message = GErrorMessage(error);
                g_error_free(error);
                // Not found is fine for idempotent logout.
                if (!message.Contains("not found", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException($"Failed to delete auth session from libsecret: {message}");
            }

            return true;
        });

        return Task.CompletedTask;
    }

    private static void EnsureLibsecretAvailable()
    {
        // Probe then Free so NativeLibrary.Load is paired (Sentry); DllImport loads again on use.
        if (!NativeLibrary.TryLoad("libsecret-1.so.0", out var handle))
        {
            throw new InvalidOperationException(
                "libsecret is required to store Toggly CLI credentials on Linux. " +
                "Install libsecret (and a desktop keyring such as gnome-keyring) or use " +
                "TOGGLY_CLIENT_ID and TOGGLY_CLIENT_SECRET for CI. " +
                "Plaintext credential files are not supported.");
        }

        NativeLibrary.Free(handle);
    }

    private static T WithSchema<T>(Func<IntPtr, T> action)
    {
        // Build a transient schema each call — AOT-safe and avoids static native lifetime issues.
        var schema = secret_schema_new(
            SchemaName,
            SECRET_SCHEMA_NONE,
            "service", SECRET_SCHEMA_ATTRIBUTE_STRING,
            "account", SECRET_SCHEMA_ATTRIBUTE_STRING,
            IntPtr.Zero);

        try
        {
            return action(schema);
        }
        finally
        {
            if (schema != IntPtr.Zero)
                secret_schema_unref(schema);
        }
    }

    private static string GErrorMessage(IntPtr error)
    {
        if (error == IntPtr.Zero)
            return "unknown error";
        var gerror = Marshal.PtrToStructure<GError>(error);
        return Marshal.PtrToStringUTF8(gerror.Message) ?? "unknown error";
    }

    private const int SECRET_SCHEMA_NONE = 0;
    private const int SECRET_SCHEMA_ATTRIBUTE_STRING = 0;
    private static readonly IntPtr SECRET_COLLECTION_DEFAULT = IntPtr.Zero;

    [StructLayout(LayoutKind.Sequential)]
    private struct GError
    {
        public uint Domain;
        public int Code;
        public IntPtr Message;
    }

    [DllImport("libsecret-1.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr secret_schema_new(
        string name,
        int flags,
        string attribute1Name,
        int attribute1Type,
        string attribute2Name,
        int attribute2Type,
        IntPtr end);

    [DllImport("libsecret-1.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern void secret_schema_unref(IntPtr schema);

    [DllImport("libsecret-1.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern bool secret_password_store_sync(
        IntPtr schema,
        IntPtr collection,
        string label,
        string password,
        IntPtr cancellable,
        ref IntPtr error,
        string attribute1Name,
        string attribute1Value,
        string attribute2Name,
        string attribute2Value,
        IntPtr end);

    [DllImport("libsecret-1.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr secret_password_lookup_sync(
        IntPtr schema,
        IntPtr cancellable,
        ref IntPtr error,
        string attribute1Name,
        string attribute1Value,
        string attribute2Name,
        string attribute2Value,
        IntPtr end);

    [DllImport("libsecret-1.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern bool secret_password_clear_sync(
        IntPtr schema,
        IntPtr cancellable,
        ref IntPtr error,
        string attribute1Name,
        string attribute1Value,
        string attribute2Name,
        string attribute2Value,
        IntPtr end);

    [DllImport("libsecret-1.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern void secret_password_free(IntPtr password);

    [DllImport("libglib-2.0.so.0", CallingConvention = CallingConvention.Cdecl)]
    private static extern void g_error_free(IntPtr error);
}
