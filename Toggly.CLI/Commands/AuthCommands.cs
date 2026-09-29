using System.CommandLine;
using System.CommandLine.Invocation;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Toggly.CLI.Services;

namespace Toggly.CLI.Commands;

/// <summary>
/// Dependencies for auth subcommands (injectable for tests).
/// </summary>
public sealed class AuthCommandDeps
{
    public Func<HttpClient> HttpClientFactory { get; init; } = () => new HttpClient();
    public Func<HttpClient, AuthService> AuthServiceFactory { get; init; } = http => new AuthService(http);
    public Func<ISecureTokenStore> TokenStoreFactory { get; init; } = SecureTokenStore.Create;
    public Action<string>? OpenUrl { get; init; }
    public TextWriter Out { get; init; } = Console.Out;
    public TextWriter Error { get; init; } = Console.Error;
}

/// <summary>
/// <c>toggly auth login|logout|status</c> commands.
/// </summary>
public static class AuthCommands
{
    public static Command Create(AuthCommandDeps? deps = null)
    {
        deps ??= new AuthCommandDeps();

        var auth = new Command("auth", "Manage interactive authentication");
        auth.AddCommand(CreateLoginCommand(deps));
        auth.AddCommand(CreateLogoutCommand(deps));
        auth.AddCommand(CreateStatusCommand(deps));
        return auth;
    }

    private static Command CreateLoginCommand(AuthCommandDeps deps)
    {
        var command = new Command("login", "Log in with the OAuth2 device-code flow");

        var authorityOption = new Option<string?>(
            "--authority",
            description: $"OAuth2 authority URL (defaults to {Constants.DefaultAuthority})");
        var clientIdOption = new Option<string?>(
            "--client-id",
            description: $"Public device client id (defaults to {Constants.DefaultDeviceClientId})");
        var scopesOption = new Option<string?>(
            "--scopes",
            description: $"OAuth scopes (defaults to '{Constants.DefaultDeviceScope}')");

        command.AddOption(authorityOption);
        command.AddOption(clientIdOption);
        command.AddOption(scopesOption);

        command.SetHandler(async (InvocationContext context) =>
        {
            try
            {
                var authority = context.ParseResult.GetValueForOption(authorityOption);
                var clientId = context.ParseResult.GetValueForOption(clientIdOption);
                var scopes = context.ParseResult.GetValueForOption(scopesOption);

                var resolvedAuthority = FirstNonEmpty(
                    authority,
                    Environment.GetEnvironmentVariable("TOGGLY_AUTHORITY"),
                    Constants.DefaultAuthority)!;
                var resolvedClientId = FirstNonEmpty(
                    clientId,
                    Environment.GetEnvironmentVariable("TOGGLY_CLIENT_ID"),
                    Constants.DefaultDeviceClientId)!;
                var resolvedScopes = FirstNonEmpty(scopes, Constants.DefaultDeviceScope)!;

                ISecureTokenStore store;
                try
                {
                    store = deps.TokenStoreFactory();
                }
                catch (Exception ex) when (ex is PlatformNotSupportedException or InvalidOperationException)
                {
                    // Re-wrap so the outer catch prints a single user-facing line.
                    throw new InvalidOperationException($"Cannot store credentials: {ex.Message}", ex);
                }

                using var httpClient = deps.HttpClientFactory();
                var authService = deps.AuthServiceFactory(httpClient);

                var device = await authService.StartDeviceAuthorizationAsync(
                    resolvedClientId,
                    resolvedAuthority,
                    resolvedScopes);

                deps.Out.WriteLine($"! First copy your one-time code: {device.UserCode}");
                var verificationUrl = string.IsNullOrEmpty(device.VerificationUriComplete)
                    ? device.VerificationUri
                    : device.VerificationUriComplete;
                deps.Out.WriteLine($"Open {verificationUrl}");

                TryOpenBrowser(deps, verificationUrl);

                var session = await authService.WaitForDeviceTokenAsync(
                    resolvedClientId,
                    resolvedAuthority,
                    device.DeviceCode,
                    device.Interval,
                    device.ExpiresIn);

                await store.SaveAsync(session);
                deps.Out.WriteLine("Logged in.");
            }
            catch (Exception ex)
            {
                deps.Error.WriteLine($"Login failed: {ex.Message}");
                context.ExitCode = 1;
            }
        });

        return command;
    }

    private static Command CreateLogoutCommand(AuthCommandDeps deps)
    {
        var command = new Command("logout", "Remove the stored device-code session");
        command.SetHandler(async (InvocationContext context) =>
        {
            try
            {
                var store = deps.TokenStoreFactory();
                await store.DeleteAsync();
                deps.Out.WriteLine("Logged out.");
            }
            catch (Exception ex) when (ex is PlatformNotSupportedException or InvalidOperationException)
            {
                // Idempotent success if there is nothing to delete / store unavailable after empty logout.
                deps.Out.WriteLine("Logged out.");
            }
            catch (Exception ex)
            {
                deps.Error.WriteLine($"Logout failed: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static Command CreateStatusCommand(AuthCommandDeps deps)
    {
        var command = new Command("status", "Show whether a device-code session is stored");
        command.SetHandler(async (InvocationContext context) =>
        {
            try
            {
                var store = deps.TokenStoreFactory();
                var session = await store.LoadAsync();
                if (session is null || string.IsNullOrEmpty(session.AccessToken))
                {
                    deps.Out.WriteLine("Not logged in.");
                    return;
                }

                // Never print access/refresh tokens — even with --verbose.
                deps.Out.WriteLine(
                    $"Logged in as client {session.ClientId} / expires {session.ExpiresAtUtc:u} / authority {session.Authority}");
            }
            catch (Exception ex) when (ex is PlatformNotSupportedException or InvalidOperationException)
            {
                deps.Out.WriteLine("Not logged in.");
            }
            catch (Exception ex)
            {
                deps.Error.WriteLine($"Status failed: {ex.Message}");
                context.ExitCode = 1;
            }
        });
        return command;
    }

    private static void TryOpenBrowser(AuthCommandDeps deps, string url)
    {
        try
        {
            if (deps.OpenUrl is not null)
            {
                deps.OpenUrl(url);
                return;
            }

            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
            {
                Process.Start("open", url);
            }
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            {
                Process.Start("xdg-open", url);
            }
        }
        catch
        {
            // Optional convenience — ignore failures.
        }
    }

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            if (!string.IsNullOrEmpty(value))
                return value;
        }

        return null;
    }
}
