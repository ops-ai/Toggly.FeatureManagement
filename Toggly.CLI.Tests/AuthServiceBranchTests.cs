using System.Net;
using System.Text;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class AuthServiceBranchTests
{
    [Fact]
    public async Task StartDeviceAuthorizationAsync_DefaultsNonPositiveInterval()
    {
        using var handler = DiscoveryAndDeviceHandler("""
            {"device_code":"dc","user_code":"UC","verification_uri":"https://auth.example.test/device","expires_in":60,"interval":0}
            """);
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var result = await service.StartDeviceAuthorizationAsync("toggly-cli", "https://auth.example.test", Constants.DefaultDeviceScope);
        Assert.Equal(5, result.Interval);
    }

    [Fact]
    public async Task StartDeviceAuthorizationAsync_ThrowsOnIncompleteResponse()
    {
        using var handler = DiscoveryAndDeviceHandler("""
            {"device_code":"dc","user_code":null,"verification_uri":"https://auth.example.test/device","expires_in":60}
            """);
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.StartDeviceAuthorizationAsync("toggly-cli", "https://auth.example.test", Constants.DefaultDeviceScope));
        Assert.Contains("incomplete", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StartDeviceAuthorizationAsync_ThrowsOnHttpError()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => ErrorResponse(HttpStatusCode.BadRequest, """
                {"error":"invalid_scope","error_description":"Unknown scope"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.StartDeviceAuthorizationAsync("toggly-cli", "https://auth.example.test", "bad"));
        Assert.Contains("invalid_scope", ex.Message);
        Assert.DoesNotContain("{\"error\"", ex.Message);
    }

    [Fact]
    public async Task GetAccessTokenAsync_ThrowsOnOAuthError()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token"}
                """),
            "/connect/token" => ErrorResponse(HttpStatusCode.Unauthorized, """
                {"error":"invalid_client","error_description":"Bad secret"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.GetAccessTokenAsync("id", "secret", "https://auth.example.test"));
        Assert.Contains("invalid_client", ex.Message);
        Assert.Contains("Bad secret", ex.Message);
    }

    [Fact]
    public async Task RefreshAccessTokenAsync_MissingRefreshToken_ThrowsSessionExpired()
    {
        using var httpClient = new HttpClient(new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound)));
        var service = new AuthService(httpClient);

        await Assert.ThrowsAsync<AuthSessionExpiredException>(() =>
            service.RefreshAccessTokenAsync(new AuthSession
            {
                AccessToken = "a",
                RefreshToken = null,
                ClientId = "toggly-cli",
                Authority = "https://auth.example.test"
            }));
    }

    [Fact]
    public async Task RefreshAccessTokenAsync_EmptyAuthority_UsesDefaultAndKeepsRefreshWhenUnrotated()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.toggly.io/connect/token","device_authorization_endpoint":"https://auth.toggly.io/connect/deviceauthorization"}
                """),
            "/connect/token" => JsonResponse("""
                {"access_token":"new-access","expires_in":3600,"token_type":"Bearer"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var refreshed = await service.RefreshAccessTokenAsync(new AuthSession
        {
            AccessToken = "old",
            RefreshToken = "keep-me",
            ClientId = "toggly-cli",
            Authority = ""
        });

        Assert.Equal("new-access", refreshed.AccessToken);
        Assert.Equal("keep-me", refreshed.RefreshToken);
        Assert.Equal(Constants.DefaultAuthority, refreshed.Authority);
        Assert.StartsWith("https://auth.toggly.io/", handler.Requests[0].RequestUri!.AbsoluteUri);
    }

    [Fact]
    public async Task RefreshAccessTokenAsync_TransientServerError_ThrowsInvalidOperation()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token"}
                """),
            "/connect/token" => ErrorResponse(HttpStatusCode.BadGateway, """
                {"error":"server_error","error_description":"Temporary outage"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.RefreshAccessTokenAsync(new AuthSession
            {
                AccessToken = "a",
                RefreshToken = "r",
                ClientId = "toggly-cli",
                Authority = "https://auth.example.test"
            }));

        Assert.IsNotType<AuthSessionExpiredException>(ex);
        Assert.Contains("server_error", ex.Message);
    }

    [Fact]
    public async Task WaitForDeviceTokenAsync_MissingAccessToken_Throws()
    {
        using var handler = TokenPollHandler("""{"refresh_token":"r","expires_in":3600}""");
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient) { PollDelayOverride = TimeSpan.Zero };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.WaitForDeviceTokenAsync("toggly-cli", "https://auth.example.test", "dc", 1, 30));
        Assert.Contains("incomplete", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task WaitForDeviceTokenAsync_ExpiredToken_Throws()
    {
        using var handler = TokenPollHandler("""{"error":"expired_token"}""", success: false);
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient) { PollDelayOverride = TimeSpan.Zero };

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.WaitForDeviceTokenAsync("toggly-cli", "https://auth.example.test", "dc", 1, 30));
        Assert.Contains("expired_token", ex.Message);
    }

    [Fact]
    public async Task WaitForDeviceTokenAsync_TimesOutWhilePending()
    {
        using var handler = TokenPollHandler("""{"error":"authorization_pending"}""", success: false);
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient) { PollDelayOverride = TimeSpan.Zero };

        await Assert.ThrowsAsync<TimeoutException>(() =>
            service.WaitForDeviceTokenAsync("toggly-cli", "https://auth.example.test", "dc", 1, expiresInSeconds: 0));
    }

    [Fact]
    public async Task GetOpenIdConfigAsync_ThrowsWhenDiscoveryFails()
    {
        using var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            service.GetAccessTokenAsync("id", "secret", "https://auth.example.test"));
    }

    [Fact]
    public void FormatOAuthFailure_StripsJwtLikeDescriptionsAndNonJsonBodies()
    {
        var jwtMessage = AuthService.FormatOAuthFailure(
            "Token refresh",
            HttpStatusCode.BadRequest,
            """{"error":"invalid_grant","error_description":"token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"}""");
        Assert.Equal("Token refresh failed (invalid_grant).", jwtMessage);

        var bare = AuthService.FormatOAuthFailure("Device token poll", HttpStatusCode.InternalServerError, "not-json");
        Assert.Equal("Device token poll failed (HTTP 500).", bare);

        var errorOnly = AuthService.FormatOAuthFailure(
            "Device authorization",
            HttpStatusCode.BadRequest,
            """{"error":"access_denied"}""");
        Assert.Equal("Device authorization failed (access_denied).", errorOnly);

        var longDesc = AuthService.FormatOAuthFailure(
            "Device authorization",
            HttpStatusCode.BadRequest,
            "{\"error\":\"access_denied\",\"error_description\":\"" + new string('x', 250) + "\"}");
        Assert.Equal("Device authorization failed (access_denied).", longDesc);
    }

    [Fact]
    public void AuthSessionExpiredException_DefaultMessageMentionsLogin()
    {
        var ex = new AuthSessionExpiredException();
        Assert.Contains("toggly auth login", ex.Message);
    }

    private static RecordingHandler DiscoveryAndDeviceHandler(string deviceJson) =>
        new(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => JsonResponse(deviceJson),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });

    private static RecordingHandler TokenPollHandler(string tokenBody, bool success = true) =>
        new(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/token" => success
                ? JsonResponse(tokenBody)
                : ErrorResponse(HttpStatusCode.BadRequest, tokenBody),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private static HttpResponseMessage ErrorResponse(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
