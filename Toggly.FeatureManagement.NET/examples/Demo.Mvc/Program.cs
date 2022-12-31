using Azure.Core;
using Azure.Identity;
using Demo.Mvc.Multitenant;
using Finbuckle.MultiTenant;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Microsoft.FeatureManagement.Mvc;
using Raven.Client.Documents;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Web.Configuration;

namespace Demo.Mvc
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            if (Environment.GetEnvironmentVariable("VaultUri") != null)
            {
                var keyVaultEndpoint = new Uri(Environment.GetEnvironmentVariable("VaultUri")!);
                TokenCredential? clientCredential = Environment.GetEnvironmentVariable("ClientId") != null ? new ClientSecretCredential(Environment.GetEnvironmentVariable("TenantId"), Environment.GetEnvironmentVariable("ClientId"), Environment.GetEnvironmentVariable("ClientSecret")) : null;

                builder.Configuration.AddAzureKeyVault(new Uri(Environment.GetEnvironmentVariable("VaultUri")!), clientCredential ?? new DefaultAzureCredential());
            }

            builder.Services.AddTogglyWeb(options =>
            {
                options.AppKey = builder.Configuration["Toggly:AppKey"]!;
                options.Environment = builder.Configuration["Toggly:Environment"]!;
            });

            builder.Services.AddSingleton<IDisabledFeaturesHandler, FeatureNotEnabledHandler>();
            builder.Services.AddSingleton<IFeatureDefinitionProvider, MultitenantFeatureDefinitionProvider>();

            // Add services to the container.
            builder.Services.AddControllersWithViews();

            builder.Services.AddMemoryCache();
            builder.Services.AddRavenDb(builder.Configuration.GetSection("Raven"));
            builder.Services.AddMultiTenant<Application>()
                .WithStore(new ServiceLifetime(), (sp) => new RavenDBMultitenantStore(sp.GetRequiredService<IDocumentStore>(), sp.GetRequiredService<IMemoryCache>()))
                .WithBasePathStrategy(opt => opt.RebaseAspNetCorePathBase = false);
            builder.Services.AddRouting(options => options.LowercaseUrls = true);
            builder.Services.AddDistributedMemoryCache();
            builder.Services.AddSession();
            builder.Services.AddRazorPages();

            var app = builder.Build();

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Error");

                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();
            app.UseSession();

            app.UseRouting();
            app.UseMultiTenant();

            app.UseStaticFiles();
            app.UseAuthorization();

            app.UseForFeature(nameof(FeatureFlags.ComingSoon), appBuilder =>
            {
                appBuilder.MapWhen(t => !t.Request.Path.StartsWithSegments($"/{t.GetMultiTenantContext<Application>()?.TenantInfo?.Identifier}/comingsoon"), req => req.Run(async context =>
                {
                    var tenantId = context.GetMultiTenantContext<Application>()?.TenantInfo?.Identifier;
                    context.Response.Redirect($"/{tenantId}/comingsoon");
                    await Task.CompletedTask;
                }));
            });

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllerRoute("default", "{__tenant__}/{action=Index}", new { controller = "Home" });
                endpoints.MapControllerRoute("default", "{__tenant__}/{controller=Home}/{action=Index}", new { controller = "Home" });
                endpoints.MapGet("/feature-debug", async ctx => await ctx.Response.WriteAsJsonAsync(new
                {
                    Metrics = ctx.RequestServices.GetRequiredService<IMetricsDebug>().GetDebugInfo(),
                    UsageStats = ctx.RequestServices.GetRequiredService<IUsageStatsDebug>().GetDebugInfo(),
                    FeatureProvider = ctx.RequestServices.GetRequiredService<IFeatureProviderDebug>().GetDebugInfo(),
                }));
                endpoints.MapFallbackToController("{__tenant__}/404", "NotFound", "Home");
            });

            app.Run();
        }
    }
}