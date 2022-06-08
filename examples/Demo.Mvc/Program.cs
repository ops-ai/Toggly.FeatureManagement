using Azure.Core;
using Azure.Identity;
using Demo.Mvc.Multitenant;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Microsoft.FeatureManagement.Mvc;
using Raven.Client.Documents;
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
                options.AppKey = builder.Configuration["Toggly:AppKey"];
                options.Environment = builder.Configuration["Toggly:Environment"];
                options.BaseUrl = "https://staging-app.toggly.io";
            });

            builder.Services.AddSingleton<IDisabledFeaturesHandler, FeatureNotEnabledHandler>();

            // Add services to the container.
            builder.Services.AddControllersWithViews();

            builder.Services.AddMemoryCache();
            builder.Services.AddRavenDb(builder.Configuration.GetSection("Raven"));
            builder.Services.AddMultiTenant<DemoApplication>()
                .WithStore(new ServiceLifetime(), (sp) => new RavenDBMultitenantStore(sp.GetRequiredService<IDocumentStore>(), sp.GetRequiredService<IMemoryCache>()))
                .WithBasePathStrategy(opt => opt.RebaseAspNetCorePathBase = false);
            builder.Services.AddRouting(options => options.LowercaseUrls = true);

            var app = builder.Build();

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Error");

                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();

            app.UseRouting();
            app.UseMultiTenant();

            app.UseStaticFiles();
            app.UseAuthorization();

            app.UseForFeature(nameof(FeatureFlags.ComingSoon), appBuilder =>
            {
                appBuilder.MapWhen(t => !t.Request.Path.StartsWithSegments("/coming-soon"), req => req.Run(async context =>
                {
                    context.Response.Redirect("/coming-soon");
                    await Task.CompletedTask;
                }));
            });

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllerRoute("default", "{__tenant__}/{action=Index}", new { controller = "Home" });
                endpoints.MapControllerRoute("default", "{__tenant__}/{controller=Home}/{action=Index}", new { controller = "Home" });
                endpoints.MapFallbackToController("{__tenant__}/404", "NotFound", "Home");
            });

            app.Run();
        }
    }
}