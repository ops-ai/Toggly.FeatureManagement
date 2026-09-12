using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Dashboard;
using Xunit;

namespace Toggly.FeatureManagement.Dashboard.Tests;

public sealed class DashboardMappingTests
{
    [Fact]
    public async Task Nested_mount_serves_dashboard_but_not_default_controller_route()
    {
        await using var host = await DashboardHost.StartAsync("/internal/features");

        var dashboard = await host.Client.GetAsync("/internal/features/");
        var accidental = await host.Client.GetAsync("/TogglyDashboard/Index");

        dashboard.StatusCode.Should().Be(HttpStatusCode.OK);
        accidental.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Root_mount_and_route_tokens_are_rejected()
    {
        var mapRoot = () => DashboardHost.Create("/");
        var mapToken = () => DashboardHost.Create("/features/{id}");

        mapRoot.Should().Throw<ArgumentException>();
        mapToken.Should().Throw<ArgumentException>();
    }

    [Fact]
    public async Task Remote_request_without_policy_is_denied()
    {
        await using var host = await DashboardHost.StartAsync("/features");
        var request = new HttpRequestMessage(HttpMethod.Get, "/features/");
        request.Headers.Add("X-Forwarded-For", "203.0.113.10");

        var response = await host.Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Editor_form_contains_an_antiforgery_token_and_assets_share_dashboard_access()
    {
        await using var host = await DashboardHost.StartAsync("/features");

        var form = await host.Client.GetAsync("/features/features/new");
        var asset = await host.Client.GetAsync("/features/assets/dashboard.css");

        form.StatusCode.Should().Be(HttpStatusCode.OK);
        (await form.Content.ReadAsStringAsync()).Should().Contain("__RequestVerificationToken");
        asset.StatusCode.Should().Be(HttpStatusCode.OK);
        asset.Content.Headers.ContentType!.MediaType.Should().Be("text/css");
    }

    [Fact]
    public async Task Mutations_require_antiforgery_and_readonly_hosts_reject_writes()
    {
        await using var host = await DashboardHost.StartAsync("/features", readOnly: true);

        var response = await host.Client.PostAsync("/features/initialize", new FormUrlEncodedContent([]));

        response.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.Forbidden);
    }
}

internal sealed class DashboardHost : IAsyncDisposable
{
    private readonly WebApplication _application;
    private DashboardHost(WebApplication application) { _application = application; }
    public HttpClient Client { get; private set; } = null!;

    public static DashboardHost Create(string mount, bool readOnly = false)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Services.AddSingleton<ITogglyCatalogStore>(new TestCatalogStore());
        builder.Services.AddTogglyDashboard(options => { options.CatalogName = "Tests"; options.ReadOnly = readOnly; });
        var application = builder.Build();
        application.Use(async (context, next) =>
        {
            context.Connection.RemoteIpAddress ??= IPAddress.Loopback;
            await next();
        });
        application.MapControllerRoute("host-default", "{controller=Home}/{action=Index}/{id?}");
        application.MapTogglyDashboard(mount);
        return new DashboardHost(application);
    }

    public static async Task<DashboardHost> StartAsync(string mount, bool readOnly = false)
    {
        var host = Create(mount, readOnly);
        await host._application.StartAsync();
        host.Client = host._application.GetTestClient();
        return host;
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _application.StopAsync();
        await _application.DisposeAsync();
    }

    private sealed class TestCatalogStore : ITogglyCatalogStore
    {
        public CatalogStoreCapabilities Capabilities { get; } = new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => Task.FromResult<CatalogSnapshot?>(null);
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default) => Task.FromResult(CatalogWriteResult.Conflict());
    }
}
