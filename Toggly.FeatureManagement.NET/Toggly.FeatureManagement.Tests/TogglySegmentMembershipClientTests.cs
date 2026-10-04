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
    [Fact]
    public async Task AddSegmentMembers_PostsIdentifiersWithBackendKey()
    {
        HttpRequestMessage? captured = null;
        var handler = new Mock<HttpMessageHandler>(MockBehavior.Strict);
        handler.Protected()
            .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
            .Returns<HttpRequestMessage, CancellationToken>((request, _) =>
            {
                captured = request;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"id\":\"abc\",\"name\":\"Beta Testers\",\"itemCount\":1}", Encoding.UTF8, "application/json")
                });
            });

        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient("toggly-app")).Returns(new HttpClient(handler.Object)
        {
            BaseAddress = new Uri("https://app.toggly.io/")
        });

        var client = new TogglySegmentMembershipClient(factory.Object, Options.Create(new TogglySettings { AppKey = "backend-key" }));
        var summary = await client.AddSegmentMembersAsync("Beta Testers", new[] { "user-1" });

        Assert.Equal("Beta Testers", summary.Name);
        Assert.NotNull(captured);
        Assert.Equal(HttpMethod.Post, captured.Method);
        Assert.Equal("/api/v2/segments/Beta%20Testers/items", captured.RequestUri!.PathAndQuery);
        Assert.Equal("backend-key", captured.Headers.GetValues("Authorization").First());
    }
}
