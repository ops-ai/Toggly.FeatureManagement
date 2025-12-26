using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Benchmarks
{
    /// <summary>
    /// Mock HTTP message handler that intercepts HTTP calls and returns success responses
    /// without making actual network requests. This prevents benchmark performance from
    /// being affected by failed HTTP connection attempts (e.g., feature refresh calls).
    /// </summary>
    public class MockHttpHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            // Return immediately without making network calls
            // This prevents benchmark performance from being affected by HTTP timeouts
            
            var response = new HttpResponseMessage(System.Net.HttpStatusCode.OK);
            
            // Handle different endpoint types
            if (request.RequestUri?.AbsolutePath.Contains("definitions") == true)
            {
                // Return empty feature definitions array for feature refresh calls
                response.Content = new StringContent("[]", System.Text.Encoding.UTF8, "application/json");
                response.Headers.ETag = new System.Net.Http.Headers.EntityTagHeaderValue("\"mock-etag\"");
            }
            else if (request.RequestUri?.AbsolutePath.Contains("live-updates") == true)
            {
                // Return empty response for WebSocket endpoint
                response.Content = new StringContent("", System.Text.Encoding.UTF8, "application/json");
            }
            else
            {
                // Default: return empty JSON
                response.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
            }
            
            return Task.FromResult(response);
        }
    }
}

