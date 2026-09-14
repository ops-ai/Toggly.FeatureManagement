using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Catalog;
using Toggly.FeatureManagement.Dashboard;
using Toggly.FeatureManagement.Configuration;
using Xunit;

namespace Toggly.FeatureManagement.Dashboard.Tests;

public sealed class DashboardMappingTests
{
    [Fact]
    public async Task Dashboard_area_does_not_collide_with_a_host_controller_of_the_same_name()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, addHostController: true);
        (await host.Client.GetAsync("/features/")).StatusCode.Should().Be(HttpStatusCode.OK);
        (await host.Client.GetStringAsync("/TogglyDashboard/Index")).Should().Be("host controller");
    }
    [Fact]
    public async Task Invalid_rule_returns_the_conditions_form_with_field_errors()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Invalid", ["Name"] = "Keep my name"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        var response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Invalid", ["Enabled"] = "true", ["Rules[0].Name"] = "Percentage", ["Rules[0].Percentage"] = "101"
        });
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("Keep my name").And.Contain("validation-summary-errors");
        host.Feature("Invalid")!.Enabled.Should().BeFalse();
        host.Feature("Invalid")!.Rules.Should().BeEmpty();
    }

    [Fact]
    public async Task Missing_upload_returns_the_import_form_with_validation_errors()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/import", "/features/import/preview", new());
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await response.Content.ReadAsStringAsync()).Should().Contain("name=\"catalog\"").And.Contain("validation-summary-errors");
    }

    [Fact]
    public async Task Tags_with_literal_commas_survive_editing()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Tags", ["Name"] = "Tags", ["Tags"] = "checkout,legacy\ncommerce"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther);
        host.Feature("Tags")!.Tags.Should().BeEquivalentTo("checkout,legacy", "commerce");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("invalid")]
    public async Task Condition_saves_require_an_explicit_valid_boolean(string? value)
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, featureCount: 1, allowWrites: true);
        var fields = new Dictionary<string, string> { ["Key"] = "Feature01", ["ExpectedRevision"] = "current" };
        if (value != null) fields["Enabled"] = value;
        var response = await PostForm(host, "/features/", "/features/features/conditions", fields);
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        host.Feature("Feature01")!.Enabled.Should().BeTrue();
    }

    [Fact]
    public async Task Claim_editor_keeps_claim_value_separate_from_rollout_percentage()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Pro", ["Name"] = "Pro"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther);
        response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Pro", ["Enabled"] = "true", ["Rules[0].Name"] = "UserClaims", ["Rules[0].Claim"] = "plan", ["Rules[0].Value"] = "pro", ["Rules[0].Percentage"] = "25"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther);
        var html = await host.Client.GetStringAsync("/features/?expand=Pro");
        html.Should().Contain("name=\"Rules[0].Percentage\" value=\"25\"").And.Contain("name=\"Rules[0].Value\" value=\"pro\"");
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/assets/dashboard.css")]
    [InlineData("/export")]
    [InlineData("/import")]
    public async Task Host_policy_protects_remote_pages_assets_and_downloads(string path)
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, usePolicy: true, remote: true);
        (await host.Client.GetAsync("/features" + path)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        host.Client.DefaultRequestHeaders.Add("X-Test-Admin", "false");
        (await host.Client.GetAsync("/features" + path)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        host.Client.DefaultRequestHeaders.Remove("X-Test-Admin");
        host.Client.DefaultRequestHeaders.Add("X-Test-Admin", "true");
        (await host.Client.GetAsync("/features" + path)).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Pathbase_and_nested_mount_are_preserved_in_forms_assets_and_redirects()
    {
        await using var host = await DashboardHost.StartAsync("/internal/flags/", catalogExists: true, allowWrites: true, pathBase: "/host");
        var html = await host.Client.GetStringAsync("/host/internal/flags/features/new");
        html.Should().Contain("/host/internal/flags/assets/dashboard.css").And.Contain("action=\"/host/internal/flags/features/create\"");
        var response = await PostForm(host, "/host/internal/flags/features/new", "/host/internal/flags/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Checkout", ["Name"] = "Checkout"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther);
        response.Headers.Location!.ToString().Should().Be("/host/internal/flags/");
        (await host.Client.GetAsync("/host/health")).StatusCode.Should().Be(HttpStatusCode.OK);
    }
    [Fact]
    public void Editable_dashboard_rejects_a_reader_store_at_mapping()
    {
        var create = () => DashboardHost.Create("/features", storeReadOnly: true);
        create.Should().Throw<InvalidOperationException>().WithMessage("*read-only catalog store*");
    }
    [Fact]
    public async Task Entity_rule_creation_retains_the_registered_schema_and_operator()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "LargeOrder", ["Name"] = "Large order", ["ContextKind"] = "Order"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "LargeOrder", ["Enabled"] = "true", ["Rules[0].Name"] = "ContextProperty", ["Rules[0].ContextKind"] = "Order", ["Rules[0].Property"] = "Total", ["Rules[0].Operator"] = "gte", ["Rules[0].Value"] = "100"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        host.Feature("LargeOrder")!.Rules.Single().Parameters["ValueType"].Should().Be("number");
        var form = await host.Client.GetStringAsync("/features/?expand=LargeOrder");
        form.Should().Contain("value=\"gte\" selected=\"selected\"");
        var export = CatalogJson.Parse(await host.Client.GetStringAsync("/features/export"));
        export.Contexts.Should().ContainSingle().Which.Kind.Should().Be("Order");
    }
    [Theory]
    [InlineData("X-Forwarded-Proto")]
    [InlineData("X-Original-Host")]
    [InlineData("X-Original-Proto")]
    [InlineData("X-Forwarded-Prefix")]
    public async Task Forwarding_headers_cannot_enable_loopback_access(string header)
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/features/");
        request.Headers.Add(header, "https");
        (await host.Client.SendAsync(request)).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Readonly_rejects_a_valid_antiforgery_post_before_running_editor_commands()
    {
        await using var host = await DashboardHost.StartAsync("/features", readOnly: true, catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Target", ["Name"] = "Target",
            ["command"] = "add-rule", ["newRuleName"] = "Targeting"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        host.Feature("Target").Should().BeNull();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(650)]
    public async Task Import_preview_and_apply_create_an_absent_catalog_through_antiforgery_protected_forms(int featureCount)
    {
        await using var host = await DashboardHost.StartAsync("/features", allowWrites: true);
        var form = await host.Client.GetAsync("/features/import");
        var html = await form.Content.ReadAsStringAsync();
        var token = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\" value=\"([^\"]+)\"").Groups[1].Value);
        var cookie = form.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith(".AspNetCore.Antiforgery.", StringComparison.Ordinal)).Split(';')[0];
        using var upload = new MultipartFormDataContent();
        upload.Add(new StringContent(token), "__RequestVerificationToken");
        var document = new CatalogDocument
        {
            Features = Enumerable.Range(0, featureCount).Select(index => new CatalogFeature
            {
                Key = index == 0 ? "Checkout" : "Checkout" + index, Name = "Checkout " + index, Description = new string('x', 6000),
                Rules = { new() { Name = "Percentage", Parameters = new() { ["Value"] = "25" } } }
            }).ToList()
        };
        upload.Add(new StringContent(CatalogJson.Serialize(document)), "catalog", "catalog.json");
        var previewRequest = new HttpRequestMessage(HttpMethod.Post, "/features/import/preview") { Content = upload };
        previewRequest.Headers.Add("Cookie", cookie);
        var preview = await host.Client.SendAsync(previewRequest);
        preview.StatusCode.Should().Be(HttpStatusCode.OK, await preview.Content.ReadAsStringAsync());
        var previewHtml = await preview.Content.ReadAsStringAsync();
        var fields = new Dictionary<string, string>();
        foreach (var name in new[] { "payload", "fingerprint", "expectedRevision", "__RequestVerificationToken" })
            fields[name] = WebUtility.HtmlDecode(Regex.Match(previewHtml, $"name=\"{name}\" value=\"([^\"]*)\"").Groups[1].Value);
        fields["selectedAddKeys"] = "Checkout";
        var apply = new HttpRequestMessage(HttpMethod.Post, "/features/import/apply") { Content = new FormUrlEncodedContent(fields) };
        apply.Headers.Add("Cookie", cookie);
        var response = await host.Client.SendAsync(apply);
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        host.Feature("Checkout")!.Enabled.Should().BeFalse();
        host.Feature("Checkout")!.Rules.Single().Parameters["Value"].Should().Be("25");
    }

    [Fact]
    public async Task Stale_create_preserves_submitted_values_and_returns_conflict()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "stale", ["IsNew"] = "true", ["Key"] = "Checkout", ["Name"] = "My unsaved name",
            ["Description"] = "My unsaved description"
        });
        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await response.Content.ReadAsStringAsync()).Should().Contain("My unsaved name").And.Contain("My unsaved description");
        host.Feature("Checkout").Should().BeNull();
    }

    [Fact]
    public async Task Saving_a_full_percentage_rule_does_not_discard_it()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Rollout", ["Name"] = "Rollout"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Rollout", ["Enabled"] = "true", ["Rules[0].Name"] = "Percentage", ["Rules[0].Percentage"] = "100"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        host.Feature("Rollout")!.Rules.Should().ContainSingle().Which.Parameters["Value"].Should().Be("100");
    }

    [Fact]
    public async Task Targeting_editor_preserves_exclusions_and_case_matching()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        var response = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Target", ["Name"] = "Target"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Target", ["Enabled"] = "true", ["Rules[0].Name"] = "Targeting", ["Rules[0].Percentage"] = "0", ["Rules[0].Users"] = "Alice",
            ["Rules[0].ExclusionUsers"] = "Bob", ["Rules[0].ExclusionGroups"] = "blocked", ["Rules[0].IgnoreCase"] = "false"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        var rule = host.Feature("Target")!.Rules.Single();
        rule.Parameters.Should().Contain("Audience.Exclusion.Users:0", "Bob").And.Contain("Audience.Exclusion.Groups:0", "blocked").And.Contain("IgnoreCase", "false");
        var form = await host.Client.GetStringAsync("/features/?expand=Target");
        form.Should().Contain("name=\"Rules[0].ExclusionUsers\">Bob</textarea>").And.Contain("name=\"Rules[0].ExclusionGroups\">blocked</textarea>");
    }

    [Fact]
    public async Task Adding_a_targeting_rule_without_javascript_defaults_to_zero_rollout()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Target", ["Name"] = "Target"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        var response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Target", ["Enabled"] = "true", ["command"] = "add-rule", ["newRuleName"] = "Targeting"
        });
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var html = await response.Content.ReadAsStringAsync();
        html.Should().Contain("name=\"Rules[0].Name\" value=\"Targeting\"")
            .And.Contain("name=\"Rules[0].Percentage\" value=\"0\"")
            .And.Contain("User.Identity.Name");
        host.Feature("Target")!.Enabled.Should().BeFalse();
        host.Feature("Target")!.Rules.Should().BeEmpty();
    }

    private static async Task<HttpResponseMessage> PostForm(DashboardHost host, string formPath, string action, Dictionary<string, string> values)
    {
        var form = await host.Client.GetAsync(formPath);
        var html = await form.Content.ReadAsStringAsync();
        if (!values.ContainsKey("ExpectedRevision"))
        {
            var revision = Regex.Match(html, "name=\"ExpectedRevision\" value=\"([^\"]+)\"");
            if (revision.Success) values["ExpectedRevision"] = WebUtility.HtmlDecode(revision.Groups[1].Value);
        }
        values["__RequestVerificationToken"] = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\" value=\"([^\"]+)\"").Groups[1].Value);
        var request = new HttpRequestMessage(HttpMethod.Post, action) { Content = new FormUrlEncodedContent(values) };
        request.Headers.Add("Cookie", form.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith(".AspNetCore.Antiforgery.", StringComparison.Ordinal)).Split(';')[0]);
        return await host.Client.SendAsync(request);
    }

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
    public async Task Feature_list_filters_the_full_catalog_and_uses_the_configured_application_name()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, featureCount: 51, applicationName: "Orders");

        var list = await host.Client.GetStringAsync("/features/");
        var filtered = await host.Client.GetStringAsync("/features/?search=Feature%2051");

        list.Should().Contain("Orders").And.Contain("Feature 01").And.Contain("Feature 51").And.Contain("logo-light.svg").And.Contain("Copy C#");
        filtered.Should().Contain("Feature 51").And.NotContain("Feature 50");
    }

    [Fact]
    public async Task Saving_an_empty_on_draft_inserts_AlwaysOn()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Checkout", ["Name"] = "Checkout"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        var response = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Checkout", ["Enabled"] = "true"
        });
        response.StatusCode.Should().Be(HttpStatusCode.SeeOther, await response.Content.ReadAsStringAsync());
        host.Feature("Checkout")!.Enabled.Should().BeTrue();
        host.Feature("Checkout")!.Rules.Should().ContainSingle().Which.Name.Should().Be("AlwaysOn");
        host.Feature("Checkout")!.Rules[0].Parameters.Should().BeEmpty();
    }

    [Fact]
    public async Task Entity_only_conditions_do_not_inject_AlwaysOn()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "LargeOrder", ["Name"] = "Large order", ["ContextKind"] = "Order"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        (await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "LargeOrder", ["Enabled"] = "true", ["Rules[0].Name"] = "ContextProperty", ["Rules[0].ContextKind"] = "Order",
            ["Rules[0].Property"] = "Total", ["Rules[0].Operator"] = "gte", ["Rules[0].Value"] = "100"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        host.Feature("LargeOrder")!.Rules.Select(rule => rule.Name).Should().Equal("ContextProperty");
    }

    [Fact]
    public async Task Turning_a_feature_off_clears_filters_and_settings_preserve_them()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Checkout", ["Name"] = "Checkout", ["Category"] = "Commerce"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        (await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Checkout", ["Enabled"] = "true", ["Rules[0].Name"] = "Percentage", ["Rules[0].Percentage"] = "10"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        (await PostForm(host, "/features/features/edit?key=Checkout", "/features/features/save", new()
        {
            ["Key"] = "Checkout", ["Name"] = "Checkout renamed", ["Category"] = "Commerce"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        host.Feature("Checkout")!.Name.Should().Be("Checkout renamed");
        host.Feature("Checkout")!.Enabled.Should().BeTrue();
        host.Feature("Checkout")!.Rules.Should().ContainSingle().Which.Name.Should().Be("Percentage");
        (await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Checkout", ["Enabled"] = "false"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        host.Feature("Checkout")!.Enabled.Should().BeFalse();
        host.Feature("Checkout")!.Rules.Should().BeEmpty();
        host.Feature("Checkout")!.Category.Should().Be("Commerce");
    }

    [Fact]
    public async Task Category_search_and_copy_csharp_cover_the_catalog()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "foo.bar", ["Name"] = "Dotted", ["Category"] = "Commerce"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["Key"] = "foo_bar", ["Name"] = "Underscore", ["Category"] = "Commerce"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        var html = await host.Client.GetStringAsync("/features/?category=Commerce");
        html.Should().Contain("Dotted").And.Contain("Underscore").And.Contain("public enum FeatureFlags").And.Contain("foo_bar__2");
        var search = await host.Client.GetStringAsync("/features/?search=foo.bar");
        search.Should().Contain("Dotted").And.NotContain("Underscore");
        var two = await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "foo.bar", ["Enabled"] = "true", ["Rules[0].Name"] = "AlwaysOn", ["Rules[1].Name"] = "Percentage", ["Rules[1].Percentage"] = "10"
        });
        two.StatusCode.Should().Be(HttpStatusCode.SeeOther, await two.Content.ReadAsStringAsync());
        var expanded = await host.Client.GetStringAsync("/features/?expand=foo.bar");
        expanded.Should().Contain("Match any").And.Contain("Match all");
        var single = await host.Client.GetStringAsync("/features/?expand=foo_bar");
        single.Should().Contain("data-match-group=\"user\"").And.Contain("is-hidden");
        var list = await host.Client.GetStringAsync("/features/");
        list.Should().Contain("aria-modal=\"true\"").And.Contain("id=\"toggly-always-on-rule\"");
        var script = await host.Client.GetStringAsync("/features/assets/dashboard.js");
        script.Should().Contain("keydown").And.Contain("Escape").And.Contain("toggly-always-on-rule");
        script.Should().Contain("persistedEnabled === \"true\" && !intended");
        script.Should().Contain("toggle.checked && draftOn");
        var css = await host.Client.GetStringAsync("/features/assets/dashboard.css");
        css.Should().Contain("--primary: #3f52c9").And.Contain("input:focus-visible + .toggle-ui");
    }

    [Fact]
    public async Task Remove_filter_is_shown_only_when_a_group_has_two_or_more_conditions()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Solo", ["Name"] = "Solo"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        (await PostForm(host, "/features/", "/features/features/conditions", new()
        {
            ["Key"] = "Solo", ["Enabled"] = "true", ["Rules[0].Name"] = "AlwaysOn"
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        var one = await host.Client.GetStringAsync("/features/?expand=Solo");
        one.Should().Contain("data-rule-name=\"AlwaysOn\"").And.NotContain("name=\"removeRuleIndex\"");
        var added = await PostForm(host, "/features/?expand=Solo", "/features/features/conditions", new()
        {
            ["Key"] = "Solo", ["Enabled"] = "true", ["Rules[0].Name"] = "AlwaysOn", ["command"] = "add-rule", ["newRuleName"] = "Percentage"
        });
        added.StatusCode.Should().Be(HttpStatusCode.OK);
        var html = await added.Content.ReadAsStringAsync();
        html.Should().Contain("name=\"removeRuleIndex\"").And.Contain("Match any");
    }

    [Fact]
    public async Task Copy_csharp_assigns_unique_members_when_sanitized_names_collide()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        foreach (var key in new[] { "a-b", "a_b", "a_b__2" })
        {
            (await PostForm(host, "/features/features/new", "/features/features/create", new()
            {
                ["Key"] = key, ["Name"] = key
            })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        }

        var html = WebUtility.HtmlDecode(await host.Client.GetStringAsync("/features/"));
        var members = Regex.Match(html, @"public enum FeatureFlags\s*\{(?<body>.*?)\}", RegexOptions.Singleline)
            .Groups["body"].Value
            .Split([',', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(member => member.Trim().TrimEnd(','))
            .Where(member => member.Length > 0)
            .ToArray();

        members.Should().Equal("a_b", "a_b__2", "a_b__2__2");
    }

    [Fact]
    public async Task Readonly_mode_disables_create_and_turn_feature_off()
    {
        await using var host = await DashboardHost.StartAsync("/features", readOnly: true, catalogExists: true, featureCount: 1);
        var html = await host.Client.GetStringAsync("/features/?expand=Feature01");
        var turnOff = Regex.Match(html, @"<button[^>]*data-turn-off[^>]*>");
        turnOff.Success.Should().BeTrue();
        turnOff.Value.Should().Contain("disabled");
        html.Should().NotContain("href=\"/features/features/new\"");
        var create = Regex.Match(html, @"<button[^>]*>\s*Create feature\s*</button>");
        create.Success.Should().BeTrue();
        create.Value.Should().Contain("disabled");
        html.Should().Contain("Editing is unavailable in the current storage or read-only mode.");
    }

    [Fact]
    public async Task Category_length_is_validated_after_trim()
    {
        await using var host = await DashboardHost.StartAsync("/features", catalogExists: true, allowWrites: true);
        (await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["ExpectedRevision"] = "current", ["IsNew"] = "true", ["Key"] = "Padded", ["Name"] = "Padded",
            ["Category"] = new string('c', 200) + "   "
        })).StatusCode.Should().Be(HttpStatusCode.SeeOther);
        host.Feature("Padded")!.Category.Should().Be(new string('c', 200));
        var tooLong = await PostForm(host, "/features/features/new", "/features/features/create", new()
        {
            ["Key"] = "TooLong", ["Name"] = "TooLong", ["Category"] = new string('c', 201)
        });
        tooLong.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        host.Feature("TooLong").Should().BeNull();
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
    private sealed class Order { public string Id { get; set; } = "one"; public decimal Total { get; set; } }
    private readonly WebApplication _application;
    private readonly TestCatalogStore _store;
    private DashboardHost(WebApplication application, TestCatalogStore store) { _application = application; _store = store; }
    public HttpClient Client { get; private set; } = null!;

    public static DashboardHost Create(string mount, bool readOnly = false, bool catalogExists = false, int featureCount = 0, string? applicationName = null, bool allowWrites = false, bool storeReadOnly = false, bool usePolicy = false, bool remote = false, string? pathBase = null, bool addHostController = false)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        if (usePolicy)
        {
            builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, DashboardTestAuthentication>("Test", _ => { });
            builder.Services.AddAuthorization(options => options.AddPolicy("FeatureAdmins", policy => policy.RequireClaim("feature-admin", "true")));
        }
        var store = new TestCatalogStore(catalogExists, featureCount, allowWrites);
        store.Capabilities.IsReadOnly = storeReadOnly;
        builder.Services.AddSingleton<ITogglyCatalogStore>(store);
        builder.Services.AddTogglyEntityContext<Order>("Order", order => order.Id, schema => schema.Property("Total", "number"));
        builder.Services.AddTogglyDashboard(options => { options.CatalogName = "Tests"; options.ReadOnly = readOnly; });
        if (addHostController) builder.Services.AddControllersWithViews().AddApplicationPart(typeof(DashboardMappingTests).Assembly);
        var application = builder.Build();
        if (pathBase != null) application.UsePathBase(pathBase);
        if (usePolicy) { application.UseAuthentication(); application.UseAuthorization(); }
        application.Use(async (context, next) =>
        {
            context.Connection.RemoteIpAddress = remote ? IPAddress.Parse("203.0.113.10") : IPAddress.Loopback;
            await next();
        });
        application.MapControllerRoute("host-default", "{controller=Home}/{action=Index}/{id?}");
        application.MapGet("/health", () => "ok");
        var host = new DashboardHost(application, store);
        var endpoints = application.MapTogglyDashboard(mount, new TogglyDashboardOptions { ApplicationName = applicationName });
        if (usePolicy) endpoints.RequireAuthorization("FeatureAdmins");
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

    public static async Task<DashboardHost> StartAsync(string mount, bool readOnly = false, bool catalogExists = false, int featureCount = 0, string? applicationName = null, bool allowWrites = false, bool usePolicy = false, bool remote = false, string? pathBase = null, bool addHostController = false)
    {
        var host = Create(mount, readOnly, catalogExists, featureCount, applicationName, allowWrites, usePolicy: usePolicy, remote: remote, pathBase: pathBase, addHostController: addHostController);
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
            if (!_allowWrites || !string.Equals(_snapshot?.Revision, expectedRevision, StringComparison.Ordinal)) return Task.FromResult(CatalogWriteResult.Conflict(_snapshot));
            _snapshot = new CatalogSnapshot { CatalogName = catalogName, Revision = Guid.NewGuid().ToString(), UpdatedAtUtc = DateTimeOffset.UtcNow, Document = document };
            return Task.FromResult(CatalogWriteResult.Written(_snapshot));
        }
    }
}

internal sealed class DashboardTestAuthentication(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-Admin", out var value)) return Task.FromResult(AuthenticateResult.NoResult());
        var identity = new ClaimsIdentity([new Claim("feature-admin", value.ToString())], Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
    }
}
