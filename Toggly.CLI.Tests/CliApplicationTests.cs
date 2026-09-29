using System.CommandLine;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Toggly.CLI;
using Toggly.CLI.Services;
using Xunit;

namespace Toggly.CLI.Tests;

public class CliApplicationTests
{
    [Fact]
    public async Task CreateRootCommand_UsesProvidedClientFactoryForFeatureCreation()
    {
        // Arrange
        using var handler = new RecordingHandler(_ => JsonResponse("""
            {"name":"Payments","featureKey":"payments-enabled"}
            """));
        using var httpClient = new HttpClient(handler);
        var apiClient = new TogglyApiClient(
            httpClient,
            new AuthService(httpClient),
            "https://api.example.test");
        var command = CliApplication.CreateRootCommand(_ => apiClient);

        // Act
        var exitCode = await command.InvokeAsync([
            "create-feature",
            "--application-id", "app-1",
            "--name", "Payments",
            "--feature-key", "payments-enabled"
        ]);

        // Assert
        Assert.Equal(0, exitCode);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/applications/app-1/features", request.RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task CreateRootCommand_UsesGlobalCredentialsWithTheDefaultClientFactory()
    {
        await using var server = await CliTestServer.StartAsync();
        var command = CliApplication.CreateRootCommand();

        var exitCode = await command.InvokeAsync([
            "--client-id", "cli-client",
            "--client-secret", "cli-secret",
            "--authority", server.BaseUrl,
            "--base-url", server.BaseUrl,
            "create-feature",
            "--application-id", "app-1",
            "--name", "Payments",
            "--feature-key", "payments-enabled"
        ]);

        Assert.Equal(0, exitCode);
        var requests = await server.Requests;
        Assert.Equal(3, requests.Count);
        Assert.Equal(("GET", "/.well-known/openid-configuration"), (requests[0].Method, requests[0].Path));
        Assert.Equal(("POST", "/connect/token"), (requests[1].Method, requests[1].Path));
        Assert.Contains("client_id=cli-client", requests[1].Body);
        Assert.Contains("client_secret=cli-secret", requests[1].Body);
        Assert.Equal(("POST", "/applications/app-1/features"), (requests[2].Method, requests[2].Path));
        Assert.Equal("Bearer cli-token", requests[2].Authorization);
        using var requestBody = JsonDocument.Parse(requests[2].Body);
        Assert.Equal("Payments", requestBody.RootElement.GetProperty("name").GetString());
        Assert.Equal("payments-enabled", requestBody.RootElement.GetProperty("featureKey").GetString());
    }

    [Fact]
    public async Task CreateRootCommand_MissingCredentials_ReturnsExitCode2()
    {
        var previousClientId = Environment.GetEnvironmentVariable("TOGGLY_CLIENT_ID");
        var previousClientSecret = Environment.GetEnvironmentVariable("TOGGLY_CLIENT_SECRET");
        try
        {
            Environment.SetEnvironmentVariable("TOGGLY_CLIENT_ID", null);
            Environment.SetEnvironmentVariable("TOGGLY_CLIENT_SECRET", null);

            var command = CliApplication.CreateRootCommand(
                secureTokenStoreFactory: () => new InMemorySecureTokenStore());

            var exitCode = await command.InvokeAsync([
                "create-feature",
                "--application-id", "app-1",
                "--name", "Payments",
                "--feature-key", "payments-enabled"
            ]);

            Assert.Equal(2, exitCode);
        }
        finally
        {
            Environment.SetEnvironmentVariable("TOGGLY_CLIENT_ID", previousClientId);
            Environment.SetEnvironmentVariable("TOGGLY_CLIENT_SECRET", previousClientSecret);
        }
    }

    private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };
}

internal sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        return Task.FromResult(responseFactory(request));
    }
}

internal sealed class CliTestServer : IAsyncDisposable
{
    private readonly HttpListener listener;
    private readonly Task<List<CliRequest>> requests;

    private CliTestServer(HttpListener listener)
    {
        this.listener = listener;
        requests = HandleRequestsAsync();
    }

    public string BaseUrl => listener.Prefixes.Single();

    public Task<List<CliRequest>> Requests => requests;

    public static Task<CliTestServer> StartAsync()
    {
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{GetAvailablePort()}/");
        listener.Start();
        return Task.FromResult(new CliTestServer(listener));
    }

    public async ValueTask DisposeAsync()
    {
        listener.Close();
        await requests;
    }

    private async Task<List<CliRequest>> HandleRequestsAsync()
    {
        var capturedRequests = new List<CliRequest>();
        try
        {
            for (var index = 0; index < 3; index++)
            {
                var context = await listener.GetContextAsync();
                using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding);
                var body = await reader.ReadToEndAsync();
                capturedRequests.Add(new(
                    context.Request.HttpMethod,
                    context.Request.Url!.AbsolutePath,
                    context.Request.Headers["Authorization"],
                    body));

                var response = context.Request.Url.AbsolutePath switch
                {
                    "/.well-known/openid-configuration" =>
                        $$"""{"token_endpoint":"{{BaseUrl}}connect/token"}""",
                    "/connect/token" => """{"access_token":"cli-token","expires_in":3600,"token_type":"Bearer"}""",
                    "/applications/app-1/features" => """{"name":"Payments","featureKey":"payments-enabled"}""",
                    _ => "{}"
                };
                var responseBytes = Encoding.UTF8.GetBytes(response);
                context.Response.ContentType = "application/json";
                context.Response.ContentLength64 = responseBytes.Length;
                await context.Response.OutputStream.WriteAsync(responseBytes);
                context.Response.Close();
            }
        }
        catch (HttpListenerException) when (!listener.IsListening)
        {
        }

        return capturedRequests;
    }

    private static int GetAvailablePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}

internal sealed record CliRequest(string Method, string Path, string? Authorization, string Body);
