using System.Net;
using System.Text.RegularExpressions;
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
    public void Root_mount_and_route_tokens_are_rejected_without_consuming_the_host_mount()
    {
        var mapRoot = () => DashboardHost.Create("/");
        var mapToken = () => DashboardHost.Create("/features/{id}");

        mapRoot.Should().Throw<ArgumentException>();
        mapToken.Should().Throw<ArgumentException>();

        var host = DashboardHost.CreateUnmapped();
        var invalidMount = () => host.Map("/");

        invalidMount.Should().Throw<ArgumentException>();
        host.Map("/features");
    }

    [Fact]
    public async Task Remote_request_without_policy_is_denied()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true);
        var request = new HttpRequestMessage(HttpMethod.Get, "/features/");
        request.Headers.Add("X-Forwarded-For", "203.0.113.10");

        var response = await host.Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Editor_form_contains_an_antiforgery_token_and_assets_share_dashboard_access()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true);

        var form = await host.Client.GetAsync("/features/features/new");
        var asset = await host.Client.GetAsync("/features/assets/dashboard.css");

        form.StatusCode.Should().Be(HttpStatusCode.OK);
        (await form.Content.ReadAsStringAsync()).Should().Contain("__RequestVerificationToken");
        asset.StatusCode.Should().Be(HttpStatusCode.OK);
        asset.Content.Headers.ContentType!.MediaType.Should().Be("text/css");
    }

    [Fact]
    public async Task Create_form_preserves_current_revision_and_dashboard_responses_are_not_stored()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true);

        var form = await host.Client.GetAsync("/features/features/new");
        var asset = await host.Client.GetAsync("/features/assets/dashboard.css");

        (await form.Content.ReadAsStringAsync()).Should().Contain("name=\"ExpectedRevision\" value=\"current\"");
        form.Headers.CacheControl!.ToString().Should().Contain("private").And.Contain("no-store");
        asset.Headers.CacheControl!.ToString().Should().Contain("private").And.Contain("no-store");
    }

    [Fact]
    public async Task Create_form_with_a_catalog_revision_still_posts_to_the_create_endpoint()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);

        var form = await host.Client.GetStringAsync("/features/features/new");

        form.Should().Contain("action=\"/features/features/create\"");
        form.Should().Contain("name=\"IsNew\" value=\"True\"");
    }

    [Fact]
    public async Task Create_uses_the_form_revision_and_persists_a_disabled_feature()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var formResponse = await host.Client.GetAsync("/features/features/new");
        var form = await formResponse.Content.ReadAsStringAsync();
        var antiforgery = Regex.Match(form, "name=\"__RequestVerificationToken\" value=\"([^\"]+)\"").Groups[1].Value;
        var cookie = formResponse.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith(".AspNetCore.Antiforgery.", StringComparison.Ordinal)).Split(';')[0];

        var request = new HttpRequestMessage(HttpMethod.Post, "/features/features/create")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
            ["__RequestVerificationToken"] = WebUtility.HtmlDecode(antiforgery),
            ["ExpectedRevision"] = "current",
            ["IsNew"] = "true",
            ["Name"] = "New checkout",
            ["Key"] = "NewCheckout",
            ["Description"] = "",
            ["Tags"] = "checkout"
            })
        };
        request.Headers.Add("Cookie", cookie);
        var response = await host.Client.SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        var created = host.Feature("NewCheckout");
        created.Should().NotBeNull();
        created!.Enabled.Should().BeFalse();
    }

    [Fact]
    public void A_second_dashboard_mount_is_rejected_for_the_same_host()
    {
        var host = DashboardHost.Create("/features");
        var mapAgain = () => host.Map("/other-features");

        mapAgain.Should().Throw<InvalidOperationException>().WithMessage("*one Toggly dashboard mount*");
    }

    [Fact]
    public async Task Operational_pages_and_export_are_mapped_under_the_dashboard_mount()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true);

        foreach (var route in new[] { "/features/contexts", "/features/storage", "/features/import", "/features/cloud", "/features/export" })
        {
            var response = await host.Client.GetAsync(route);
            response.StatusCode.Should().Be(HttpStatusCode.OK, route);
            response.Headers.CacheControl!.ToString().Should().Contain("private").And.Contain("no-store");
        }
    }

    [Fact]
    public async Task Feature_list_filters_and_paginates_on_the_server_and_uses_the_configured_application_name()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, featureCount: 51, applicationName: "Orders");

        var firstPage = await host.Client.GetStringAsync("/features/?state=enabled&page=1");
        var secondPage = await host.Client.GetStringAsync("/features/?state=enabled&page=2");
        var filtered = await host.Client.GetStringAsync("/features/?search=Feature%2051");

        firstPage.Should().Contain("Orders").And.Contain("Feature 01").And.NotContain("Feature 51");
        secondPage.Should().Contain("Feature 51").And.NotContain("Feature 01");
        filtered.Should().Contain("Feature 51").And.NotContain("Feature 50");
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
    private readonly TestCatalogStore _store;
    private DashboardHost(WebApplication application, TestCatalogStore store) { _application = application; _store = store; }
    public HttpClient Client { get; private set; } = null!;

    public static DashboardHost Create(string mount, bool readOnly = false, bool catalogExists = false, int featureCount = 0, string? applicationName = null, bool allowWrites = false)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        var store = new TestCatalogStore(catalogExists, featureCount, allowWrites);
        builder.Services.AddSingleton<ITogglyCatalogStore>(store);
        builder.Services.AddTogglyDashboard(options => { options.CatalogName = "Tests"; options.ReadOnly = readOnly; });
        var application = builder.Build();
        application.Use(async (context, next) =>
        {
            context.Connection.RemoteIpAddress ??= IPAddress.Loopback;
            await next();
        });
        application.MapControllerRoute("host-default", "{controller=Home}/{action=Index}/{id?}");
        var host = new DashboardHost(application, store);
        host.Map(mount, applicationName);
        return host;
    }

    public static DashboardHost CreateUnmapped()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        var store = new TestCatalogStore(false, 0);
        builder.Services.AddSingleton<ITogglyCatalogStore>(store);
        builder.Services.AddTogglyDashboard(options => options.CatalogName = "Tests");
        return new DashboardHost(builder.Build(), store);
    }

    public static async Task<DashboardHost> StartAsync(string mount, bool readOnly = false, bool catalogExists = false, int featureCount = 0, string? applicationName = null, bool allowWrites = false)
    {
        var host = Create(mount, readOnly, catalogExists, featureCount, applicationName, allowWrites);
        await host._application.StartAsync();
        host.Client = host._application.GetTestClient();
        return host;
    }

    public void Map(string mount, string? applicationName = null) => _application.MapTogglyDashboard(mount, new TogglyDashboardOptions { ApplicationName = applicationName });

    public CatalogFeature? Feature(string key) => _store.Feature(key);

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _application.StopAsync();
        await _application.DisposeAsync();
    }

    private sealed class TestCatalogStore : ITogglyCatalogStore
    {
        private CatalogSnapshot? _snapshot;
        private readonly bool _allowWrites;
        public TestCatalogStore(bool catalogExists, int featureCount, bool allowWrites = false)
        {
            _allowWrites = allowWrites;
            if (catalogExists)
            {
                _snapshot = new CatalogSnapshot { CatalogName = "Tests", Revision = "current", UpdatedAtUtc = DateTimeOffset.UtcNow, Document = new CatalogDocument() };
                for (var index = 1; index <= featureCount; index++)
                {
                    _snapshot.Document.Features.Add(new CatalogFeature { Key = $"Feature{index:00}", Name = $"Feature {index:00}", Enabled = true });
                }
            }
        }
        public CatalogStoreCapabilities Capabilities { get; } = new() { SupportsMultipleWriters = true };
        public Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default) => Task.FromResult(_snapshot);

        public CatalogFeature? Feature(string key) => _snapshot?.Document.Features.SingleOrDefault(feature => string.Equals(feature.Key, key, StringComparison.Ordinal));
        public Task<CatalogWriteResult> TryWriteAsync(string catalogName, CatalogDocument document, string? expectedRevision, CancellationToken cancellationToken = default)
        {
            if (!_allowWrites || _snapshot == null || !string.Equals(_snapshot.Revision, expectedRevision, StringComparison.Ordinal)) return Task.FromResult(CatalogWriteResult.Conflict(_snapshot));
            _snapshot = new CatalogSnapshot { CatalogName = catalogName, Revision = "next", UpdatedAtUtc = DateTimeOffset.UtcNow, Document = document };
            return Task.FromResult(CatalogWriteResult.Written(_snapshot));
        }
    }
}
