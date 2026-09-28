using System.CommandLine;
using System.Net;
using System.Text;
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
