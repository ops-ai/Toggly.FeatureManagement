using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglySegmentMembershipClientTests
{
    private static readonly string[] SampleIdentifiers = ["user-1"];

    private sealed class RequestCapture
    {
        public HttpRequestMessage? Request { get; set; }
    }

    private static (TogglySegmentMembershipClient Client, RequestCapture Capture) Build(
        HttpStatusCode status = HttpStatusCode.OK,
        string body = "{\"id\":\"abc\",\"name\":\"Beta Testers\",\"itemCount\":1}")
    {
        var capture = new RequestCapture();
        var handler = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>((request, _) =>
            {
                capture.Request = request;
                return Task.FromResult(new HttpResponseMessage(status)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json")
                });
            });

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("toggly-app")).Returns(new HttpClient(handler.Object)
        {
            BaseAddress = new Uri("https://app.toggly.io/")
        });

        return (new TogglySegmentMembershipClient(
            factory.Object,
            Options.Create(new TogglySettings { AppKey = "backend-key" })), capture);
    }

    [Fact]
    public async Task ListSegments_UsesGet()
    {
        var (client, capture) = Build(body: "[{\"id\":\"abc\",\"name\":\"Beta Testers\",\"itemCount\":1}]");
        var segments = await client.ListSegmentsAsync();
        Assert.Single(segments);
        Assert.Equal(HttpMethod.Get, capture.Request!.Method);
        Assert.Equal("/api/v2/segments", capture.Request.RequestUri!.PathAndQuery);
        Assert.Equal("backend-key", capture.Request.Headers.GetValues("Authorization").First());
    }

    [Fact]
    public async Task AddSegmentMembers_PostsIdentifiersWithBackendKey()
    {
        var (client, capture) = Build();
        var summary = await client.AddSegmentMembersAsync("Beta Testers", SampleIdentifiers);

        Assert.Equal("Beta Testers", summary.Name);
        Assert.Equal(HttpMethod.Post, capture.Request!.Method);
        Assert.Equal("/api/v2/segments/Beta%20Testers/items", capture.Request.RequestUri!.PathAndQuery);
        Assert.Equal("backend-key", capture.Request.Headers.GetValues("Authorization").First());
    }

    [Fact]
    public async Task RemoveSegmentMembers_DeletesIdentifiers()
    {
        var (client, capture) = Build();
        await client.RemoveSegmentMembersAsync("Beta Testers", SampleIdentifiers);
        Assert.Equal(HttpMethod.Delete, capture.Request!.Method);
        Assert.Equal("/api/v2/segments/Beta%20Testers/items", capture.Request.RequestUri!.PathAndQuery);
    }

    [Fact]
    public async Task ReplaceSegmentMembers_PutsIdentifiers()
    {
        var (client, capture) = Build();
        await client.ReplaceSegmentMembersAsync("Beta Testers", SampleIdentifiers);
        Assert.Equal(HttpMethod.Put, capture.Request!.Method);
        Assert.Equal("/api/v2/segments/Beta%20Testers/items", capture.Request.RequestUri!.PathAndQuery);
    }

    [Fact]
    public async Task ListItems_UsesQuery()
    {
        var (client, capture) = Build(body: "{"items":[{"identifier":"user-1"}],"skip":0,"take":10,"total":1}");
        var page = await client.ListItemsAsync("Beta Testers", 0, 10);
        Assert.Single(page.Items);
        Assert.Equal(HttpMethod.Get, capture.Request!.Method);
        Assert.Equal("/api/v2/segments/Beta%20Testers/items?skip=0&take=10", capture.Request.RequestUri!.PathAndQuery);
    }

    [Fact]
    public async Task HttpError_Throws()
    {
        var (client, _) = Build(HttpStatusCode.Forbidden, "{}");
        await Assert.ThrowsAsync<HttpRequestException>(() => client.ListSegmentsAsync());
    }
}
