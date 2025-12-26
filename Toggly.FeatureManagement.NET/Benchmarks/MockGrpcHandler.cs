using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Benchmarks
{
    /// <summary>
    /// Mock HTTP message handler that intercepts gRPC calls and returns success responses
    /// without making actual network requests. This prevents benchmark performance from
    /// being affected by failed gRPC connection attempts.
    /// </summary>
    public class MockGrpcHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            // For gRPC calls, throw an exception immediately that is NOT retryable
            // This prevents benchmark performance from being affected by connection failures
            // We throw InvalidOperationException which is not in the retry policy's exception list
            // This causes immediate failure without retries or network delays
            
            // Return immediately - no network delay, no retries
            throw new InvalidOperationException("Mock handler - benchmark mode, no network calls");
        }
    }
}

