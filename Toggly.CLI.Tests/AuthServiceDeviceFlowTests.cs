using System.Net;
using System.Text;
using System.Text.Json;
using Toggly.CLI.Models;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class AuthServiceDeviceFlowTests
{
    [Fact]
    public async Task StartDeviceAuthorizationAsync_PostsToDeviceEndpoint()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/deviceauthorization" => JsonResponse("""
                {"device_code":"dc-1","user_code":"ABCD-EFGH","verification_uri":"https://auth.example.test/device","verification_uri_complete":"https://auth.example.test/device?user_code=ABCD-EFGH","expires_in":600,"interval":5}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        var result = await service.StartDeviceAuthorizationAsync(
            Constants.DefaultDeviceClientId,
            "https://auth.example.test",
            Constants.DefaultDeviceScope);

        Assert.Equal("dc-1", result.DeviceCode);
        Assert.Equal("ABCD-EFGH", result.UserCode);
        Assert.Equal("https://auth.example.test/device", result.VerificationUri);
        Assert.Equal(5, result.Interval);
        Assert.Equal(2, handler.Requests.Count);
        var body = await handler.Requests[1].Content!.ReadAsStringAsync();
        Assert.Contains("client_id=toggly-cli", body);
        Assert.Contains("scope=openid", body);
        Assert.Contains("offline_access", body);
    }

    [Fact]
    public async Task WaitForDeviceTokenAsync_PollsUntilSuccess_RespectingPendingAndSlowDown()
    {
        var pollCount = 0;
        using var handler = new RecordingHandler(request =>
        {
            if (request.RequestUri!.AbsolutePath == "/.well-known/openid-configuration")
            {
                return JsonResponse("""
                    {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                    """);
            }

            if (request.RequestUri!.AbsolutePath == "/connect/token")
            {
                pollCount++;
                return pollCount switch
                {
                    1 => ErrorResponse(HttpStatusCode.BadRequest, """{"error":"authorization_pending"}"""),
                    2 => ErrorResponse(HttpStatusCode.BadRequest, """{"error":"slow_down"}"""),
                    _ => JsonResponse("""
                        {"access_token":"access-1","refresh_token":"refresh-1","expires_in":3600,"token_type":"Bearer"}
                        """)
                };
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient) { PollDelayOverride = TimeSpan.Zero };

        var session = await service.WaitForDeviceTokenAsync(
            Constants.DefaultDeviceClientId,
            "https://auth.example.test",
            "dc-1",
            intervalSeconds: 1,
            expiresInSeconds: 120);

        Assert.Equal("access-1", session.AccessToken);
        Assert.Equal("refresh-1", session.RefreshToken);
        Assert.Equal(Constants.DefaultDeviceClientId, session.ClientId);
        Assert.Equal("https://auth.example.test", session.Authority);
        Assert.True(session.ExpiresAtUtc > DateTime.UtcNow.AddMinutes(50));
        Assert.Equal(3, pollCount);
    }

    [Fact]
    public async Task RefreshAccessTokenAsync_PostsRefreshGrantWithoutSecret()
    {
        using var handler = new RecordingHandler(request => request.RequestUri!.AbsolutePath switch
        {
            "/.well-known/openid-configuration" => JsonResponse("""
                {"token_endpoint":"https://auth.example.test/connect/token","device_authorization_endpoint":"https://auth.example.test/connect/deviceauthorization"}
                """),
            "/connect/token" => JsonResponse("""
                {"access_token":"access-2","refresh_token":"refresh-2","expires_in":3600,"token_type":"Bearer"}
                """),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound)
        });
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);
        var session = new AuthSession
        {
            AccessToken = "access-old",
            RefreshToken = "refresh-old",
            ExpiresAtUtc = DateTime.UtcNow.AddMinutes(-1),
            Authority = "https://auth.example.test",
            ClientId = Constants.DefaultDeviceClientId,
            TokenType = "Bearer"
        };

        var refreshed = await service.RefreshAccessTokenAsync(session);

        Assert.Equal("access-2", refreshed.AccessToken);
        Assert.Equal("refresh-2", refreshed.RefreshToken);
        var body = await handler.Requests[^1].Content!.ReadAsStringAsync();
        Assert.Contains("grant_type=refresh_token", body);
        Assert.Contains("refresh_token=refresh-old", body);
        Assert.Contains("client_id=toggly-cli", body);
        Assert.DoesNotContain("client_secret", body);
    }

    [Fact]
    public async Task StartDeviceAuthorizationAsync_ThrowsWhenDeviceEndpointMissing()
    {
        using var handler = new RecordingHandler(_ => JsonResponse("""
            {"token_endpoint":"https://auth.example.test/connect/token"}
            """));
        using var httpClient = new HttpClient(handler);
        var service = new AuthService(httpClient);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.StartDeviceAuthorizationAsync("toggly-cli", "https://auth.example.test", Constants.DefaultDeviceScope));
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    private static HttpResponseMessage ErrorResponse(HttpStatusCode status, string json) => new(status)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}
