using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Data;
using Toggly.Web;

namespace Toggly.FeatureManagement.Benchmarks
{
    /// <summary>
    /// Helper class for creating test data and services for benchmarks
    /// </summary>
    public static class TestDataHelpers
    {
        /// <summary>
        /// Creates a mock snapshot provider with predefined feature definitions
        /// </summary>
        public static MockSnapshotProvider CreateMockSnapshotProvider(List<FeatureDefinitionModel>? features = null)
        {
            return new MockSnapshotProvider(features ?? CreateDefaultFeatureDefinitions());
        }

        /// <summary>
        /// Creates default feature definitions for testing
        /// </summary>
        public static List<FeatureDefinitionModel> CreateDefaultFeatureDefinitions()
        {
            return new List<FeatureDefinitionModel>
            {
                new FeatureDefinitionModel
                {
                    FeatureKey = "SimpleFlag",
                    Filters = new List<FeatureFilter>
                    {
                        new AlwaysOnFilter { Name = "AlwaysOn" }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = "PercentageFlag50",
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Percentage",
                            Parameters = new Dictionary<string, string> { { "Value", "50" } }
                        }
                    },
                    RequirementType = RequirementType.Any
                },
                new FeatureDefinitionModel
                {
                    FeatureKey = "UserTargetingFlag",
                    Filters = new List<FeatureFilter>
                    {
                        new FeatureFilter
                        {
                            Name = "Targeting",
                            Parameters = new Dictionary<string, string>
                            {
                                { "Users", "user1,user2,user3" }
                            }
                        }
                    },
                    RequirementType = RequirementType.Any
                }
            };
        }

        /// <summary>
        /// Creates feature definitions with many flags for cache size testing
        /// </summary>
        public static List<FeatureDefinitionModel> CreateManyFeatureDefinitions(int count)
        {
            var features = new List<FeatureDefinitionModel>();
            for (int i = 0; i < count; i++)
            {
                features.Add(new FeatureDefinitionModel
                {
                    FeatureKey = $"Feature{i}",
                    Filters = new List<FeatureFilter>
                    {
                        new AlwaysOnFilter { Name = "AlwaysOn" }
                    },
                    RequirementType = RequirementType.Any
                });
            }
            return features;
        }

        /// <summary>
        /// Creates a service provider with Toggly services configured
        /// </summary>
        public static IServiceProvider CreateServiceProvider(
            IFeatureSnapshotProvider? snapshotProvider = null,
            bool enableStats = true)
        {
            var services = new ServiceCollection();
            
            // Add logging - suppress errors from gRPC clients during benchmarks
            services.AddLogging(builder => 
            {
                // Suppress all logs from stats and metrics services to avoid gRPC connection errors
                builder.AddFilter(typeof(TogglyUsageStatsProvider).FullName!, LogLevel.None);
                builder.AddFilter(typeof(TogglyMetricsService).FullName!, LogLevel.None);
                builder.AddConsole().SetMinimumLevel(LogLevel.Warning);
            });
            
            // Add hosting environment
            services.AddSingleton<IHostEnvironment>(new MockHostEnvironment());
            
            // Add host application lifetime (required by TogglyMetricsService and TogglyUsageStatsProvider)
            services.AddSingleton<IHostApplicationLifetime>(new MockHostApplicationLifetime());
            
            // Add Toggly settings
            services.Configure<TogglySettings>(options =>
            {
                options.AppKey = "benchmark-app-key";
                options.Environment = "Benchmark";
                options.UndefinedEnabledOnDevelopment = false;
                options.UseSignedDefinitions = false;
            });
            
            // Add feature snapshot provider
            if (snapshotProvider != null)
            {
                services.AddSingleton<IFeatureSnapshotProvider>(snapshotProvider);
            }
            else
            {
                services.AddSingleton<IFeatureSnapshotProvider>(CreateMockSnapshotProvider());
            }
            
            // Add Toggly services
            services.AddToggly();
            services.AddTogglyFeatureManagement();
            
            // Override HTTP client for "toggly" to use mock handler (prevents feature refresh timeouts)
            // Re-configuring after AddToggly() will override the previous configuration
            services.AddHttpClient("toggly")
                .ConfigurePrimaryHttpMessageHandler(() => new MockHttpHandler())
                .SetHandlerLifetime(TimeSpan.FromMinutes(60));
            
            // Override gRPC client handlers to use mock handler that prevents actual network calls
            // This prevents benchmark performance from being affected by failed gRPC connection attempts
            // Re-configuring the gRPC clients will override the previous registration
            services.AddGrpcClient<Usage.UsageClient>((sp, options) =>
            {
                var baseUrl = sp.GetRequiredService<IOptions<TogglySettings>>().Value.BaseUrl;
                options.Address = new Uri(baseUrl ?? "https://app.toggly.io");
            }).ConfigurePrimaryHttpMessageHandler(() => new Grpc.Net.Client.Web.GrpcWebHandler(new MockGrpcHandler()));
            
            services.AddGrpcClient<Metrics.MetricsClient>((sp, options) =>
            {
                var baseUrl = sp.GetRequiredService<IOptions<TogglySettings>>().Value.BaseUrl;
                options.Address = new Uri(baseUrl ?? "https://app.toggly.io");
            }).ConfigurePrimaryHttpMessageHandler(() => new Grpc.Net.Client.Web.GrpcWebHandler(new MockGrpcHandler()));
            
            // Optionally disable stats
            if (!enableStats)
            {
                // Note: This would require modifying the service registration
                // For now, we'll use the default behavior
            }
            
            return services.BuildServiceProvider();
        }

        /// <summary>
        /// Gets a feature manager from the service provider
        /// </summary>
        public static async Task<IFeatureManager> GetFeatureManagerAsync(IServiceProvider serviceProvider)
        {
            var provider = serviceProvider.GetRequiredService<TogglyFeatureProvider>();
            
            // Wait for initial load by polling - the timer fires immediately and loads from snapshot
            var maxWaitTime = TimeSpan.FromSeconds(2);
            var elapsed = TimeSpan.Zero;
            var delay = TimeSpan.FromMilliseconds(50);
            
            // Use reflection to check the _loaded field
            var loadedField = typeof(TogglyFeatureProvider).GetField("_loaded", 
                BindingFlags.NonPublic | BindingFlags.Instance);
            
            while (elapsed < maxWaitTime)
            {
                if (loadedField?.GetValue(provider) is bool loaded && loaded)
                {
                    break;
                }
                await Task.Delay(delay);
                elapsed = elapsed.Add(delay);
            }
            
            return serviceProvider.GetRequiredService<IFeatureManager>();
        }
    }

    /// <summary>
    /// Mock snapshot provider for benchmarks
    /// </summary>
    public class MockSnapshotProvider : IFeatureSnapshotProvider
    {
        private readonly FeatureDefinitionsSnapshot _snapshot;

        public MockSnapshotProvider(List<FeatureDefinitionModel> features, string? signature = null, string? keyId = null, long? timestamp = null)
        {
            _snapshot = new FeatureDefinitionsSnapshot
            {
                Features = features,
                Signature = signature,
                KeyId = keyId,
                Timestamp = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            };
        }

        public Task<FeatureDefinitionsSnapshot?> GetFeaturesSnapshotAsync(CancellationToken ct = default)
        {
            return Task.FromResult<FeatureDefinitionsSnapshot?>(_snapshot);
        }

        public Task SaveSnapshotAsync(FeatureDefinitionsSnapshot snapshot, CancellationToken ct = default)
        {
            // No-op for benchmarks
            return Task.CompletedTask;
        }

        public Task ClearSnapshotAsync(CancellationToken ct = default)
        {
            return Task.CompletedTask;
        }

        public Task<(JsonWebKeySet? Jwks, long? Timestamp)> GetJwkSnapshotAsync(CancellationToken ct = default)
        {
            return Task.FromResult<(JsonWebKeySet?, long?)>((null, null));
        }

        public Task SaveJwkSnapshot(JsonWebKeySet jwks, long timestamp, CancellationToken ct = default)
        {
            return Task.CompletedTask;
        }

        public Task ClearJwkSnapshotAsync(CancellationToken ct = default)
        {
            return Task.CompletedTask;
        }
    }

    /// <summary>
    /// Mock host environment for benchmarks
    /// </summary>
    public class MockHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Benchmark";
        public string ApplicationName { get; set; } = "Benchmarks";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    }

    /// <summary>
    /// Mock host application lifetime for benchmarks
    /// </summary>
    public class MockHostApplicationLifetime : IHostApplicationLifetime
    {
        private readonly CancellationTokenSource _stoppingCts = new CancellationTokenSource();
        private readonly CancellationTokenSource _stoppedCts = new CancellationTokenSource();

        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => _stoppingCts.Token;
        public CancellationToken ApplicationStopped => _stoppedCts.Token;

        public void StopApplication()
        {
            _stoppingCts.Cancel();
        }

        public void Dispose()
        {
            _stoppingCts?.Dispose();
            _stoppedCts?.Dispose();
        }
    }
}

