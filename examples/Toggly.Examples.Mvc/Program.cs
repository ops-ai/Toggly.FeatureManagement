using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.Examples.Mvc;
using Toggly.Examples.Mvc.Data;
using Toggly.Examples.Mvc.FeatureFlags;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Storage.RavenDB;
using Azure.Identity;
using Toggly.FeatureManagement.Helpers;
using Toggly.FeatureManagement.Web;

var builder = WebApplication.CreateBuilder(args);

var keyVaultEndpoint = new Uri(Environment.GetEnvironmentVariable("VaultUri")!);
builder.Configuration.AddAzureKeyVault(keyVaultEndpoint, new DefaultAzureCredential());

builder.Services.AddOptions();
builder.Services.Configure<TogglySettings>(builder.Configuration.GetSection("Toggly"));

builder.Services.AddRavenDb(builder.Configuration.GetSection("Raven"));
builder.Services.AddSingleton<IFeatureSnapshotProvider, RavenDBFeatureSnapshotProvider>();

builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient("toggly", config =>
{
    config.BaseAddress = new Uri(builder.Configuration["Toggly:BaseUrl"]);
})
    .ConfigurePrimaryHttpMessageHandler(() => { return new SocketsHttpHandler { UseCookies = false }; });

builder.Services.AddSingleton<IFeatureContextProvider, HttpFeatureContextProvider>();
builder.Services.AddSingleton<IFeatureDefinitionProvider, TogglyFeatureProvider>();
builder.Services.AddSingleton<IFeatureUsageStatsProvider, TogglyUsageStatsProvider>();

builder.Services.AddSingleton<ITargetingContextAccessor, HttpContextTargetingContextAccessor>();
builder.Services.AddFeatureManagement()
        .AddFeatureFilter<PercentageFilter>()
        .AddFeatureFilter<TimeWindowFilter>()
        .AddFeatureFilter<TargetingFilter>();
builder.Services.Decorate<IFeatureManager, TogglyFeatureManager>();

builder.Services.Configure<FeatureManagementOptions>(options =>
{
    options.IgnoreMissingFeatureFilters = true;
});

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
