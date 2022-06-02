using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.Examples.Mvc;
using Toggly.Examples.Mvc.Data;
using Toggly.Examples.Mvc.FeatureFlags;
using Azure.Identity;
using Toggly.FeatureManagement.Storage.RavenDB.Configuration;
using Toggly.FeatureManagement.Web.Configuration;

var builder = WebApplication.CreateBuilder(args);

var keyVaultEndpoint = new Uri(Environment.GetEnvironmentVariable("VaultUri")!);
builder.Configuration.AddAzureKeyVault(keyVaultEndpoint, new DefaultAzureCredential());

builder.Services.AddOptions();

builder.Services.AddRavenDb(builder.Configuration.GetSection("Raven"));
builder.Services.AddTogglyWeb(options =>
    {
        options.AppKey = builder.Configuration["Toggly:AppKey"];
        options.Environment = builder.Configuration["Toggly:Environment"];
    });
builder.Services.AddTogglyRavenDbSnapshotProvider();

builder.Services.AddSingleton<ITargetingContextAccessor, HttpContextTargetingContextAccessor>();


// Add services to the container.
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
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

app.UseMiddlewareForFeature<ThirdPartyMiddleware>(nameof(MyFeatureFlags.FeatureU));

app.MapRazorPages();

app.Run();
