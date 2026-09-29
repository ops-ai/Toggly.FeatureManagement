using System.CommandLine;
using System.Net;
using System.Text;
using Toggly.CLI.Commands;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class AuthCommandsBranchTests
{
    [Fact]
    public async Task AuthLogin_WithoutVerificationUriComplete_UsesVerificationUri()
    {
        var opened = new List<string>();
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => JsonResponse("""
                {"device_code":"dc-1","user_code":"WXYZ-1234","verification_uri":"https://auth.example.test/device","expires_in":300,"interval":1}
                """),
            "/connect/token" => JsonResponse("""
                {"access_token":"a","refresh_token":"r","expires_in":3600,"token_type":"Bearer"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });

        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            HttpClientFactory = () => new HttpClient(handler, disposeHandler: false),
            AuthServiceFactory = http => new AuthService(http) { PollDelayOverride = TimeSpan.Zero },
            TokenStoreFactory = () => new InMemorySecureTokenStore(),
            OpenUrl = opened.Add,
            Out = outWriter,
            Error = new StringWriter()
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps).InvokeAsync([
            "auth", "login", "--authority", "https://auth.example.test"
        ]);

        Assert.Equal(0, exitCode);
        Assert.Contains("Open https://auth.example.test/device", outWriter.ToString());
        Assert.DoesNotContain("user_code=", outWriter.ToString());
        Assert.Equal(["https://auth.example.test/device"], opened);
    }

    [Fact]
    public async Task AuthLogin_PlatformNotSupportedStore_ReturnsNonZero()
    {
        var err = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => throw new PlatformNotSupportedException("unsupported"),
            Out = new StringWriter(),
            Error = err
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps)
            .InvokeAsync(["auth", "login"]);

        Assert.Equal(1, exitCode);
        Assert.Contains("Cannot store credentials: unsupported", err.ToString());
    }

    [Fact]
    public async Task AuthLogin_UsesCustomScopesAndDefaultsWhenOptionsOmitted()
    {
        string? capturedScope = null;
        using var handler = new RecordingHandler(request =>
        {
            if (request.RequestUri!.AbsolutePath == "/.well-known/openid-configuration")
            {
                return JsonResponse("""
                    {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                    """);
            }

            if (request.RequestUri.AbsolutePath == "/connect/deviceauthorization")
            {
                capturedScope = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
                return JsonResponse("""
                    {"device_code":"dc-1","user_code":"CODE","verification_uri":"https://auth.example.test/device","expires_in":60,"interval":1}
                    """);
            }

            return JsonResponse("""
                {"access_token":"a","refresh_token":"r","expires_in":3600,"token_type":"Bearer"}
                """);
        });

        var deps = new AuthCommandDeps
        {
            HttpClientFactory = () => new HttpClient(handler, disposeHandler: false),
            AuthServiceFactory = http => new AuthService(http) { PollDelayOverride = TimeSpan.Zero },
            TokenStoreFactory = () => new InMemorySecureTokenStore(),
            OpenUrl = _ => { },
            Out = new StringWriter(),
            Error = new StringWriter()
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps).InvokeAsync([
            "auth", "login",
            "--authority", "https://auth.example.test",
            "--scopes", "openid toggly offline_access custom"
        ]);

        Assert.Equal(0, exitCode);
        Assert.Contains("custom", capturedScope);
    }

    [Fact]
    public async Task AuthLogin_WithoutOpenUrlHook_StillSucceeds()
    {
        // Exercises TryOpenBrowser process-start path; failures are best-effort/silent.
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => JsonResponse("""
                {"device_code":"dc-1","user_code":"CODE","verification_uri":"https://auth.example.test/device","verification_uri_complete":"https://auth.example.test/device?user_code=CODE","expires_in":60,"interval":1}
                """),
            "/connect/token" => JsonResponse("""
                {"access_token":"a","refresh_token":"r","expires_in":3600,"token_type":"Bearer"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });

        var store = new InMemorySecureTokenStore();
        var deps = new AuthCommandDeps
        {
            HttpClientFactory = () => new HttpClient(handler, disposeHandler: false),
            AuthServiceFactory = http => new AuthService(http) { PollDelayOverride = TimeSpan.Zero },
            TokenStoreFactory = () => store,
            OpenUrl = null,
            Out = new StringWriter(),
            Error = new StringWriter()
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps).InvokeAsync([
            "auth", "login", "--authority", "https://auth.example.test"
        ]);

        Assert.Equal(0, exitCode);
        Assert.NotNull(await store.LoadAsync());
    }

    [Fact]
    public async Task AuthLogout_StoreUnavailable_StillSucceedsIdempotently()
    {
        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => throw new InvalidOperationException("no keyring"),
            Out = outWriter,
            Error = new StringWriter()
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps)
            .InvokeAsync(["auth", "logout"]);

        Assert.Equal(0, exitCode);
        Assert.Contains("Logged out.", outWriter.ToString());
    }

    [Fact]
    public async Task AuthLogout_UnexpectedFailure_ReturnsNonZero()
    {
        var err = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => throw new IOException("disk error"),
            Out = new StringWriter(),
            Error = err
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps)
            .InvokeAsync(["auth", "logout"]);

        Assert.Equal(1, exitCode);
        Assert.Contains("Logout failed: disk error", err.ToString());
    }

    [Fact]
    public async Task AuthStatus_StoreUnavailable_PrintsNotLoggedIn()
    {
        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => throw new InvalidOperationException("no keyring"),
            Out = outWriter,
            Error = new StringWriter()
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps)
            .InvokeAsync(["auth", "status"]);

        Assert.Equal(0, exitCode);
        Assert.Contains("Not logged in.", outWriter.ToString());
    }

    [Fact]
    public async Task AuthStatus_EmptyAccessToken_PrintsNotLoggedIn()
    {
        var store = new InMemorySecureTokenStore();
        await store.SaveAsync(new AuthSession
        {
            AccessToken = "",
            RefreshToken = "r",
            ClientId = "toggly-cli",
            Authority = Constants.DefaultAuthority,
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1)
        });

        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => store,
            Out = outWriter,
            Error = new StringWriter()
        };

        Assert.Equal(0, await CliApplication.CreateRootCommand(authDeps: deps).InvokeAsync(["auth", "status"]));
        Assert.Contains("Not logged in.", outWriter.ToString());
    }

    [Fact]
    public async Task AuthStatus_UnexpectedFailure_ReturnsNonZero()
    {
        var err = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => throw new TimeoutException("timeout"),
            Out = new StringWriter(),
            Error = err
        };

        var exitCode = await CliApplication.CreateRootCommand(authDeps: deps)
            .InvokeAsync(["auth", "status"]);

        Assert.Equal(1, exitCode);
        Assert.Contains("Status failed: timeout", err.ToString());
    }

    [Fact]
    public void AuthCommands_Create_WithNullDeps_UsesDefaults()
    {
        var command = AuthCommands.Create(null);
        Assert.Equal("auth", command.Name);
        Assert.Contains(command.Subcommands, c => c.Name == "login");
        Assert.Contains(command.Subcommands, c => c.Name == "logout");
        Assert.Contains(command.Subcommands, c => c.Name == "status");
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
