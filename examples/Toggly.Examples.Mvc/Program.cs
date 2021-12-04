using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.FeatureFilters;
using Toggly.Examples.Mvc.Data;
using Toggly.Examples.Mvc.FeatureFlags;
using Toggly.FeatureManagement;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOptions();
builder.Services.Configure<TogglySettings>(builder.Configuration.GetSection("Toggly"));

builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient();
builder.Services.AddHttpClient("toggly", config =>
{
    config.BaseAddress = new Uri(builder.Configuration["Toggly:BaseUrl"]);
})
    .ConfigurePrimaryHttpMessageHandler(() => { return new SocketsHttpHandler { UseCookies = false }; });

builder.Services.AddSingleton<IFeatureDefinitionProvider, TogglyFeatureProvider>();

builder.Services.AddSingleton<ITargetingContextAccessor, HttpContextTargetingContextAccessor>();
builder.Services.AddFeatureManagement()
        .AddFeatureFilter<PercentageFilter>()
        .AddFeatureFilter<TimeWindowFilter>()
        .AddFeatureFilter<TargetingFilter>();

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
