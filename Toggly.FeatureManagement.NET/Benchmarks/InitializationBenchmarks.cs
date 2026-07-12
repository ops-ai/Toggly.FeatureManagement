using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Data;
using Toggly.Web;

namespace Toggly.FeatureManagement.Benchmarks
{
    [MemoryDiagnoser]
    [SimpleJob(RuntimeMoniker.Net90)]
    [MarkdownExporter]
    [RankColumn]
    public class InitializationBenchmarks
    {
        private List<FeatureDefinitionModel> _testFeatures = null!;

        [GlobalSetup]
        public void Setup()
        {
            _testFeatures = TestDataHelpers.CreateDefaultFeatureDefinitions();
        }

        /// <summary>
        /// Time to configure DI container with Toggly services
        /// </summary>
        [Benchmark]
        public IServiceProvider ServiceCollectionSetup()
        {
            var services = new ServiceCollection();
            
            services.AddLogging(builder => builder.AddConsole().SetMinimumLevel(LogLevel.Warning));
            services.AddHttpClient("toggly");
            services.AddSingleton<IHostEnvironment>(new MockHostEnvironment());
            
            // Add host application lifetime (required by TogglyMetricsService and TogglyUsageStatsProvider)
            services.AddSingleton<IHostApplicationLifetime>(new MockHostApplicationLifetime());
            
            services.Configure<TogglySettings>(options =>
            {
                options.AppKey = "benchmark-app-key";
                options.Environment = "Benchmark";
                options.UndefinedEnabledOnDevelopment = false;
                options.UseSignedDefinitions = false;
            });
            
            var snapshotProvider = new MockSnapshotProvider(_testFeatures);
            services.AddSingleton<IFeatureSnapshotProvider>(snapshotProvider);
            
            services.AddToggly();
            services.AddTogglyFeatureManagement();
            
            // Override HTTP client for "toggly" to use mock handler (prevents feature refresh timeouts)
            services.AddHttpClient("toggly")
                .ConfigurePrimaryHttpMessageHandler(() => new MockHttpHandler())
                .SetHandlerLifetime(TimeSpan.FromMinutes(60));
            
            // Override gRPC client handlers to use mock handler
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
            
            return services.BuildServiceProvider();
        }

        /// <summary>
        /// Time to initialize TogglyFeatureProvider and load flags from snapshot
        /// </summary>
        [Benchmark]
        public async Task<TogglyFeatureProvider> ProviderInitialization()
        {
            var serviceProvider = ServiceCollectionSetup();
            var provider = serviceProvider.GetRequiredService<TogglyFeatureProvider>();
            
            // Wait for initial load to complete
            await Task.Delay(200);
            
            return provider;
        }

        /// <summary>
        /// Time to load flags from snapshot provider (simulates startup fetch)
        /// </summary>
        [Benchmark]
        public async Task<FeatureDefinitionsSnapshot?> InitialFlagLoad()
        {
            var snapshotProvider = new MockSnapshotProvider(_testFeatures);
            return await snapshotProvider.GetFeaturesSnapshotAsync();
        }

        /// <summary>
        /// Time for first evaluation after initialization completes (flags already loaded)
        /// </summary>
        [Benchmark]
        public async Task<bool> FirstEvaluationAfterInit()
        {
            var serviceProvider = ServiceCollectionSetup();
            var featureManager = await TestDataHelpers.GetFeatureManagerAsync(serviceProvider);
            
            // First evaluation after initialization
            return await featureManager.IsEnabledAsync("SimpleFlag");
        }
    }
}

