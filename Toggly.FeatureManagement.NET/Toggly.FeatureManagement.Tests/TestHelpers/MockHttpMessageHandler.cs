using System.Net;
using System.Text;

namespace Toggly.FeatureManagement.Tests.TestHelpers;

/// <summary>
/// Mock HTTP message handler for testing that returns configurable responses.
/// </summary>
public class MockHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage>? _responseFactory;
    private readonly HttpResponseMessage? _defaultResponse;
    private readonly List<HttpRequestMessage> _requests = new();

    /// <summary>
    /// Gets all requests that were sent through this handler.
    /// </summary>
    public IReadOnlyList<HttpRequestMessage> Requests => _requests.AsReadOnly();

    /// <summary>
    /// Creates a handler that returns a default OK response with empty JSON.
    /// </summary>
    public MockHttpMessageHandler()
    {
        _defaultResponse = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("{}", Encoding.UTF8, "application/json")
        };
    }

    /// <summary>
    /// Creates a handler that returns the specified response.
    /// </summary>
    public MockHttpMessageHandler(HttpResponseMessage response)
    {
        _defaultResponse = response;
    }

    /// <summary>
    /// Creates a handler that uses a factory to create responses based on the request.
    /// </summary>
    public MockHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
    {
        _responseFactory = responseFactory;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        _requests.Add(request);

        if (_responseFactory != null)
        {
            return Task.FromResult(_responseFactory(request));
        }

        return Task.FromResult(_defaultResponse!);
    }

    /// <summary>
    /// Creates a handler that returns a JSON response with the specified content.
    /// </summary>
    public static MockHttpMessageHandler WithJsonResponse(string json, HttpStatusCode statusCode = HttpStatusCode.OK)
    {
        var response = new HttpResponseMessage(statusCode)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        return new MockHttpMessageHandler(response);
    }

    /// <summary>
    /// Creates a handler that returns empty feature definitions.
    /// </summary>
    public static MockHttpMessageHandler WithEmptyFeatures()
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("[]", Encoding.UTF8, "application/json")
        };
        response.Headers.ETag = new System.Net.Http.Headers.EntityTagHeaderValue("\"mock-etag\"");
        return new MockHttpMessageHandler(response);
    }

    /// <summary>
    /// Creates a handler that returns feature definitions with the specified JSON.
    /// </summary>
    public static MockHttpMessageHandler WithFeatures(string featuresJson)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(featuresJson, Encoding.UTF8, "application/json")
        };
        response.Headers.ETag = new System.Net.Http.Headers.EntityTagHeaderValue("\"mock-etag\"");
        return new MockHttpMessageHandler(response);
    }

    /// <summary>
    /// Creates a handler that returns an error response.
    /// </summary>
    public static MockHttpMessageHandler WithError(HttpStatusCode statusCode = HttpStatusCode.InternalServerError)
    {
        return new MockHttpMessageHandler(new HttpResponseMessage(statusCode));
    }
}
