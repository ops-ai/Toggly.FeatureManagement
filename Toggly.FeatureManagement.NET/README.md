# ASP.NET Core Feature Flag Extensions for Hangfire

To simplify the use of Hangfire with feature flags, we created a set of extensions for ASP.NET Core. The extensions allow you to easily configure Hangfire to use feature flags to enable or disable background jobs.

## Installation

```bash
dotnet add package Toggly.FeatureManagement.Hangfire
```

## Before

``` C#
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
```

## After

``` C#
var featureStateService = app.Services.GetRequiredService<IFeatureStateService>();
featureStateService.AddOrUpdateJob<ITestRecurringJob>(FeatureFlags.HourlyJob.ToString(), "Hourly job", s => s.RunAsync(), Cron.Hourly());
```