using System.CommandLine;
using System.Net;
using System.Text;
using Toggly.CLI.Commands;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class AuthCommandsTests
{
    [Fact]
    public async Task AuthLogin_StoresSessionAndPrintsInstructionsWithoutTokens()
    {
        var store = new InMemorySecureTokenStore();
        var outWriter = new StringWriter();
        var errWriter = new StringWriter();
        var openedUrls = new List<string>();

        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => JsonResponse("""
                {"device_code":"dc-1","user_code":"ABCD-EFGH","verification_uri":"https://auth.example.test/device","verification_uri_complete":"https://auth.example.test/device?user_code=ABCD-EFGH","expires_in":600,"interval":1}
                """),
            "/connect/token" => JsonResponse("""
                {"access_token":"secret-access","refresh_token":"secret-refresh","expires_in":3600,"token_type":"Bearer"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });

        var deps = new AuthCommandDeps
        {
            HttpClientFactory = () => new HttpClient(handler, disposeHandler: false),
            AuthServiceFactory = http => new AuthService(http) { PollDelayOverride = TimeSpan.Zero },
            TokenStoreFactory = () => store,
            OpenUrl = openedUrls.Add,
            Out = outWriter,
            Error = errWriter
        };

        var root = CliApplication.CreateRootCommand(authDeps: deps);
        var exitCode = await root.InvokeAsync([
            "auth", "login",
            "--authority", "https://auth.example.test",
            "--client-id", "toggly-cli"
        ]);

        Assert.Equal(0, exitCode);
        var output = outWriter.ToString();
        Assert.Contains("ABCD-EFGH", output);
        Assert.Contains("https://auth.example.test/device", output);
        Assert.Contains("Logged in.", output);
        Assert.DoesNotContain("secret-access", output);
        Assert.DoesNotContain("secret-refresh", output);
        Assert.DoesNotContain("secret-access", errWriter.ToString());
        Assert.Contains("https://auth.example.test/device?user_code=ABCD-EFGH", openedUrls);

        var session = await store.LoadAsync();
        Assert.NotNull(session);
        Assert.Equal("secret-access", session!.AccessToken);
        Assert.True(store.LastSaveToken.CanBeCanceled);
    }

    [Fact]
    public async Task AuthStatus_ShowsMetadataWithoutTokens()
    {
        var store = new InMemorySecureTokenStore();
        await store.SaveAsync(new AuthSession
        {
            AccessToken = "secret-access",
            RefreshToken = "secret-refresh",
            ExpiresAtUtc = DateTime.UnixEpoch.AddHours(2),
            Authority = "https://auth.example.test",
            ClientId = "toggly-cli"
        });

        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => store,
            Out = outWriter,
            Error = new StringWriter()
        };

        var root = CliApplication.CreateRootCommand(authDeps: deps);
        var exitCode = await root.InvokeAsync(["auth", "status"]);

        Assert.Equal(0, exitCode);
        var output = outWriter.ToString();
        Assert.Contains("Logged in as client toggly-cli", output);
        Assert.Contains("https://auth.example.test", output);
        Assert.DoesNotContain("secret-access", output);
        Assert.DoesNotContain("secret-refresh", output);
    }

    [Fact]
    public async Task AuthLogout_ClearsStore_Idempotent()
    {
        var store = new InMemorySecureTokenStore();
        await store.SaveAsync(new AuthSession
        {
            AccessToken = "token",
            RefreshToken = "refresh",
            ExpiresAtUtc = DateTime.UtcNow.AddHours(1),
            ClientId = "toggly-cli",
            Authority = Constants.DefaultAuthority
        });

        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => store,
            Out = outWriter,
            Error = new StringWriter()
        };

        var root = CliApplication.CreateRootCommand(authDeps: deps);
        Assert.Equal(0, await root.InvokeAsync(["auth", "logout"]));
        Assert.Null(await store.LoadAsync());
        Assert.True(store.LastDeleteToken.CanBeCanceled);
        Assert.Equal(0, await root.InvokeAsync(["auth", "logout"]));
        Assert.Contains("Logged out.", outWriter.ToString());
    }

    [Fact]
    public async Task AuthStatus_WhenEmpty_PrintsNotLoggedIn()
    {
        var store = new InMemorySecureTokenStore();
        var outWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => store,
            Out = outWriter,
            Error = new StringWriter()
        };

        var root = CliApplication.CreateRootCommand(authDeps: deps);
        Assert.Equal(0, await root.InvokeAsync(["auth", "status"]));
        Assert.Contains("Not logged in.", outWriter.ToString());
        Assert.True(store.LastLoadToken.CanBeCanceled);
    }

    [Fact]
    public async Task AuthLogin_StoreUnavailable_ReturnsNonZeroExitCode()
    {
        var errWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            TokenStoreFactory = () => throw new InvalidOperationException("libsecret is required"),
            Out = new StringWriter(),
            Error = errWriter
        };

        var root = CliApplication.CreateRootCommand(authDeps: deps);
        var exitCode = await root.InvokeAsync(["auth", "login", "--authority", "https://auth.example.test"]);

        Assert.Equal(1, exitCode);
        var error = errWriter.ToString();
        Assert.Contains("Login failed: Cannot store credentials: libsecret is required", error);
        Assert.Single(error.Split("Login failed:", StringSplitOptions.RemoveEmptyEntries));
    }

    [Fact]
    public async Task AuthLogin_DeviceAuthorizationFailure_ReturnsNonZeroExitCode()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent(
                    """{"error":"unauthorized_client","error_description":"Client is not allowed"}""",
                    Encoding.UTF8,
                    "application/json")
            },
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });

        var errWriter = new StringWriter();
        var deps = new AuthCommandDeps
        {
            HttpClientFactory = () => new HttpClient(handler, disposeHandler: false),
            TokenStoreFactory = () => new InMemorySecureTokenStore(),
            Out = new StringWriter(),
            Error = errWriter
        };

        var root = CliApplication.CreateRootCommand(authDeps: deps);
        var exitCode = await root.InvokeAsync([
            "auth", "login",
            "--authority", "https://auth.example.test",
            "--client-id", "toggly-cli"
        ]);

        Assert.Equal(1, exitCode);
        Assert.Contains("Login failed:", errWriter.ToString());
        Assert.Contains("unauthorized_client", errWriter.ToString());
        Assert.DoesNotContain("{\"error\"", errWriter.ToString());
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
