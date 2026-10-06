using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Toggly.FeatureManagement
{
    public interface ITogglySegmentMembershipClient
    {
        Task<IReadOnlyList<TogglySegmentSummary>> ListSegmentsAsync(CancellationToken cancellationToken = default);
        Task<TogglySegmentItemsPage> ListItemsAsync(string segment, int skip = 0, int take = 100, CancellationToken cancellationToken = default);
        Task<TogglySegmentSummary> AddSegmentMembersAsync(string segment, IReadOnlyList<string> identifiers, CancellationToken cancellationToken = default);
        Task<TogglySegmentSummary> RemoveSegmentMembersAsync(string segment, IReadOnlyList<string> identifiers, CancellationToken cancellationToken = default);
        Task<TogglySegmentSummary> ReplaceSegmentMembersAsync(string segment, IReadOnlyList<string> identifiers, CancellationToken cancellationToken = default);
    }

    public class TogglySegmentSummary
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Environment { get; set; }
        public int ItemCount { get; set; }
    }

    public class TogglySegmentMember
    {
        public string Identifier { get; set; } = string.Empty;
        public string? Description { get; set; }
    }

    public class TogglySegmentItemsPage
    {
        public List<TogglySegmentMember> Items { get; set; } = new List<TogglySegmentMember>();
        public int Skip { get; set; }
        public int Take { get; set; }
        public int Total { get; set; }
    }

    public sealed class TogglySegmentMembershipClient : ITogglySegmentMembershipClient
    {
        private static readonly JsonSerializerSettings JsonSettings = new JsonSerializerSettings
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            NullValueHandling = NullValueHandling.Ignore
        };

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IOptions<TogglySettings> _settings;

        public TogglySegmentMembershipClient(IHttpClientFactory httpClientFactory, IOptions<TogglySettings> settings)
        {
            _httpClientFactory = httpClientFactory;
            _settings = settings;
        }

        public async Task<IReadOnlyList<TogglySegmentSummary>> ListSegmentsAsync(CancellationToken cancellationToken = default)
        {
            var result = await SendAsync<List<TogglySegmentSummary>>(HttpMethod.Get, "/api/v2/segments", null, cancellationToken).ConfigureAwait(false);
            return result ?? (IReadOnlyList<TogglySegmentSummary>)Array.Empty<TogglySegmentSummary>();
        }

        public async Task<TogglySegmentItemsPage> ListItemsAsync(string segment, int skip = 0, int take = 100, CancellationToken cancellationToken = default)
        {
            var page = await SendAsync<TogglySegmentItemsPage>(HttpMethod.Get, $"/api/v2/segments/{Uri.EscapeDataString(segment)}/items?skip={skip}&take={take}", null, cancellationToken).ConfigureAwait(false);
            return page ?? new TogglySegmentItemsPage();
        }

        public Task<TogglySegmentSummary> AddSegmentMembersAsync(string segment, IReadOnlyList<string> identifiers, CancellationToken cancellationToken = default)
            => SendAsync<TogglySegmentSummary>(HttpMethod.Post, $"/api/v2/segments/{Uri.EscapeDataString(segment)}/items", new { identifiers }, cancellationToken);

        public Task<TogglySegmentSummary> RemoveSegmentMembersAsync(string segment, IReadOnlyList<string> identifiers, CancellationToken cancellationToken = default)
            => SendAsync<TogglySegmentSummary>(HttpMethod.Delete, $"/api/v2/segments/{Uri.EscapeDataString(segment)}/items", new { identifiers }, cancellationToken);

        public Task<TogglySegmentSummary> ReplaceSegmentMembersAsync(string segment, IReadOnlyList<string> identifiers, CancellationToken cancellationToken = default)
            => SendAsync<TogglySegmentSummary>(HttpMethod.Put, $"/api/v2/segments/{Uri.EscapeDataString(segment)}/items", new { identifiers }, cancellationToken);

        private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, CancellationToken cancellationToken)
        {
            var client = _httpClientFactory.CreateClient("toggly-app");
            using var request = new HttpRequestMessage(method, path);
            request.Headers.TryAddWithoutValidation("Authorization", _settings.Value.AppKey);
            request.Headers.TryAddWithoutValidation("Accept", "application/json");
            if (body != null)
            {
                request.Content = new StringContent(JsonConvert.SerializeObject(body, JsonSettings), Encoding.UTF8, "application/json");
            }

            using var response = await client.SendAsync(request, cancellationToken).ConfigureAwait(false);
            #if NET5_0_OR_GREATER
            var payload = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
#else
            cancellationToken.ThrowIfCancellationRequested();
            var payload = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
#endif
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"Segment membership {method} {path} failed with {(int)response.StatusCode}: {payload}");

            // Mutations may return 204/empty bodies; honor non-nullable contracts.
            if (string.IsNullOrWhiteSpace(payload))
            {
                if (typeof(T).IsValueType)
                    return default!;
                return Activator.CreateInstance<T>()!;
            }

            try
            {
                return JsonConvert.DeserializeObject<T>(payload, JsonSettings)!;
            }
            catch (JsonException ex)
            {
                throw new HttpRequestException($"Segment membership {method} {path} returned invalid JSON", ex);
            }
        }
    }
}
