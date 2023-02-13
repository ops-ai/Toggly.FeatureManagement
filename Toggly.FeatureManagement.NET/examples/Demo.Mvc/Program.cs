using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Web.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Hangfire;
using Demo.Mvc.Jobs;

namespace Demo.Mvc
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Services.AddTogglyWeb(options =>
            {
                options.AppKey = builder.Configuration["Toggly:AppKey"]!;
                options.Environment = builder.Configuration["Toggly:Environment"]!;
                options.UndefinedEnabledOnDevelopment = true;
            });

            builder.Services.AddSingleton<IDisabledFeaturesHandler, FeatureNotEnabledHandler>();

            // Add services to the container.
            builder.Services.AddControllersWithViews();

            builder.Services.AddRouting(options => options.LowercaseUrls = true);
            builder.Services.AddDistributedMemoryCache();
            builder.Services.AddSession();
            builder.Services.AddRazorPages().AddRazorRuntimeCompilation();
            builder.Services.AddTransient<ITestRecurringJob, TestRecurringJob>();

            builder.Services.AddHangfire(config =>
            {
                config.UseSimpleAssemblyNameTypeSerializer().UseRecommendedSerializerSettings();

                config.UseInMemoryStorage();
            });

            builder.Services.AddHangfireServer();
            builder.Services.AddPerformanceMetrics(new Dictionary<string, Dictionary<string, string>>
            {
                {  "System.Runtime", new Dictionary<string, string>
                    {
                        {"time-in-gc", "TimeInGC"},
                        {"alloc-rate", "AllocationRate"},
                        {"cpu-usage", "CpuUsage"},
                        {"exception-count", "ExceptionCount"},
                        {"gc-heap-size", "GCHeapSize"},
                        {"working-set", "MemoryWorkingSet"},
                    }
                },
                { "Microsoft.AspNetCore.Hosting", new Dictionary<string, string>
                    {
                        { "requests-per-second", "RequestsPerSecond" },
                    }
                }
            });

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

            var featureStateService = app.Services.GetRequiredService<IFeatureStateService>();
            featureStateService.WhenFeatureTurnsOn(FeatureFlags.HourlyJob, () =>
            {
                //start a service or job
                RecurringJob.AddOrUpdate<ITestRecurringJob>("Hourly job", s => s.RunAsync(), Cron.Hourly());
            });

            featureStateService.WhenFeatureTurnsOff(FeatureFlags.HourlyJob, () =>
            {
                //stop a service or job
                RecurringJob.RemoveIfExists("Hourly job");
            });

            app.MapControllerRoute("default", "{action=Index}", new { controller = "Home" });
            app.MapControllerRoute("default", "{controller=Home}/{action=Index}", new { controller = "Home" });
            app.MapGet("/feature-debug", async ctx => await ctx.Response.WriteAsJsonAsync(new
            {
                Metrics = ctx.RequestServices.GetRequiredService<IMetricsDebug>().GetDebugInfo(),
                UsageStats = ctx.RequestServices.GetRequiredService<IUsageStatsDebug>().GetDebugInfo(),
                FeatureProvider = ctx.RequestServices.GetRequiredService<IFeatureProviderDebug>().GetDebugInfo(),
            }));
            app.MapHangfireDashboard();
            app.MapFallbackToController("404", "NotFound", "Home");

            app.Run();
        }
    }
}