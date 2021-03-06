using Microsoft.AspNetCore.Session;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Microsoft.FeatureManagement.Mvc;
using Toggly.FeatureManagement.Web.Configuration;

namespace Demo.Mvc
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            builder.Services.AddTogglyWeb(options =>
            {
                options.AppKey = builder.Configuration["Toggly:AppKey"];
                options.Environment = builder.Configuration["Toggly:Environment"];
                //options.BaseUrl = "https://staging-app.toggly.io";
            });

            builder.Services.AddSingleton<IDisabledFeaturesHandler, FeatureNotEnabledHandler>();

            // Add services to the container.
            builder.Services.AddControllersWithViews();

            builder.Services.AddRouting(options => options.LowercaseUrls = true);
            builder.Services.AddDistributedMemoryCache();
            builder.Services.AddSession();

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

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllerRoute("default", "{action=Index}", new { controller = "Home" });
                endpoints.MapControllerRoute("default", "{controller=Home}/{action=Index}", new { controller = "Home" });
                endpoints.MapFallbackToController("404", "NotFound", "Home");
            });

            app.Run();
        }
    }
}