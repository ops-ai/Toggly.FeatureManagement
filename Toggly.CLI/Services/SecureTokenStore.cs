using System.Runtime.Versioning;

namespace Toggly.CLI.Services;

/// <summary>
/// Factory for the platform OS credential store used by device-code sessions.
/// </summary>
public static class SecureTokenStore
{
    /// <summary>
    /// Creates the OS-backed token store for the current platform.
    /// </summary>
    /// <exception cref="PlatformNotSupportedException">When the OS has no supported store.</exception>
    public static ISecureTokenStore Create()
    {
        if (OperatingSystem.IsWindows())
            return CreateWindows();

        if (OperatingSystem.IsMacOS())
            return CreateMacOS();

        if (OperatingSystem.IsLinux())
            return CreateLinux();

        throw new PlatformNotSupportedException(
            "Toggly CLI secure credential storage is only supported on Windows, macOS, and Linux. " +
            "Use TOGGLY_CLIENT_ID and TOGGLY_CLIENT_SECRET for machine authentication.");
    }

    [SupportedOSPlatform("windows")]
    private static ISecureTokenStore CreateWindows() => new WindowsCredentialStore();

    [SupportedOSPlatform("macos")]
    private static ISecureTokenStore CreateMacOS() => new MacOSKeychainStore();

    [SupportedOSPlatform("linux")]
    private static ISecureTokenStore CreateLinux() => new LinuxLibsecretStore();
}
