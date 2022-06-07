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
                options.BaseUrl = "https://staging-app.toggly.io";
            });

            builder.Services.AddSingleton<IDisabledFeaturesHandler, FeatureNotEnabledHandler>();
            
            // Add services to the container.
            builder.Services.AddControllersWithViews();

            var app = builder.Build();

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Error");

                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();
            app.UseStaticFiles();

            app.UseRouting();

            app.UseAuthorization();

            app.UseForFeature(nameof(FeatureFlags.ComingSoon), appBuilder =>
            {
                appBuilder.MapWhen(t => !t.Request.Path.StartsWithSegments("/coming-soon"), req => req.Run(async context =>
                {
                    context.Response.Redirect("/coming-soon");
                    await Task.CompletedTask;
                }));
            });

            app.MapControllerRoute(
                name: "default",
                pattern: "{controller=Home}/{action=Index}/{id?}");
            app.MapFallbackToController("NotFound", "Home");

            app.Run();
        }
    }
}