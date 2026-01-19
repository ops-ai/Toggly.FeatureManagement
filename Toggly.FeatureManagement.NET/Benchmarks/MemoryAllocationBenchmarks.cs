using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.FeatureManagement;
using System;
using System.Linq;
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
    [BaselineColumn]
    public class MemoryAllocationBenchmarks
    {
        private IFeatureManager _featureManager = null!;
        private IFeatureManager _featureManagerNoStats = null!;
        private IServiceProvider _serviceProvider = null!;
        private IServiceProvider _serviceProviderNoStats = null!;
        private const string SimpleFlagName = "SimpleFlag";
        private readonly string[] _flagNames = { "Feature0", "Feature1", "Feature2", "Feature3", "Feature4" };

        [GlobalSetup]
        public async Task Setup()
        {
            // Setup with usage stats (default)
            var snapshotProvider = TestDataHelpers.CreateMockSnapshotProvider();
            _serviceProvider = TestDataHelpers.CreateServiceProvider(snapshotProvider);
            _featureManager = await TestDataHelpers.GetFeatureManagerAsync(_serviceProvider);
            
            // Setup without usage stats
            _serviceProviderNoStats = CreateServiceProviderWithoutStats(snapshotProvider);
            _featureManagerNoStats = await TestDataHelpers.GetFeatureManagerAsync(_serviceProviderNoStats);
            
            // Warmup
            await _featureManager.IsEnabledAsync(SimpleFlagName);
            await _featureManagerNoStats.IsEnabledAsync(SimpleFlagName);
        }
        
        private IServiceProvider CreateServiceProviderWithoutStats(IFeatureSnapshotProvider snapshotProvider)
        {
            var services = new ServiceCollection();
            
            services.AddLogging(builder => 
            {
                builder.AddFilter(typeof(TogglyUsageStatsProvider).FullName!, LogLevel.None);
                builder.AddFilter(typeof(TogglyMetricsService).FullName!, LogLevel.None);
                builder.AddConsole().SetMinimumLevel(LogLevel.Warning);
            });
            
            services.AddSingleton<IHostEnvironment>(new Toggly.FeatureManagement.Benchmarks.MockHostEnvironment());
            services.AddSingleton<IHostApplicationLifetime>(new Toggly.FeatureManagement.Benchmarks.MockHostApplicationLifetime());
            
            services.Configure<TogglySettings>(options =>
            {
                options.AppKey = "benchmark-app-key";
                options.Environment = "Benchmark";
                options.UndefinedEnabledOnDevelopment = false;
                options.UseSignedDefinitions = false;
            });
            
            services.AddSingleton<IFeatureSnapshotProvider>(snapshotProvider);
            
            // Register no-op usage stats provider BEFORE AddToggly
            services.AddSingleton<IFeatureUsageStatsProvider>(new NoOpUsageStatsProvider());
            
            services.AddToggly();
            services.AddTogglyFeatureManagement();
            
            // Override HTTP and gRPC clients
            services.AddHttpClient("toggly")
                .ConfigurePrimaryHttpMessageHandler(() => new MockHttpHandler())
                .SetHandlerLifetime(TimeSpan.FromMinutes(60));
            
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

        [GlobalCleanup]
        public void Cleanup()
        {
            if (_serviceProvider is IDisposable disposable)
            {
                disposable.Dispose();
            }
            if (_serviceProviderNoStats is IDisposable disposableNoStats)
            {
                disposableNoStats.Dispose();
            }
        }

        /// <summary>
        /// Memory allocated per simple evaluation (with usage stats - default)
        /// </summary>
        [Benchmark(Baseline = true)]
        public async Task<bool> EvaluationMemoryAllocation()
        {
            return await _featureManager.IsEnabledAsync(SimpleFlagName);
        }
        
        /// <summary>
        /// Memory allocated per simple evaluation (without usage stats)
        /// </summary>
        [Benchmark]
        public async Task<bool> EvaluationMemoryAllocationNoStats()
        {
            return await _featureManagerNoStats.IsEnabledAsync(SimpleFlagName);
        }

        /// <summary>
        /// Memory for context-based evaluation
        /// </summary>
        [Benchmark]
        public async Task<bool> ContextEvaluationMemoryAllocation()
        {
            var context = new { UserId = "test-user", SessionId = "test-session" };
            return await _featureManager.IsEnabledAsync(SimpleFlagName, context);
        }

        /// <summary>
        /// Memory for evaluating many flags
        /// </summary>
        [Benchmark]
        [Arguments(10)]
        [Arguments(50)]
        [Arguments(100)]
        public async Task<bool> BulkEvaluationMemoryAllocation(int count)
        {
            bool result = false;
            for (int i = 0; i < count; i++)
            {
                result = await _featureManager.IsEnabledAsync(_flagNames[i % _flagNames.Length]);
            }
            return result;
        }
    }
    
    /// <summary>
    /// No-op usage stats provider for benchmarking without stats overhead
    /// </summary>
    internal class NoOpUsageStatsProvider : IFeatureUsageStatsProvider
    {
        public Task RecordCheckAsync(string featureKey, bool allowed) => Task.CompletedTask;
        public Task RecordUsageAsync<TContext>(string featureKey, TContext context, bool allowed) => Task.CompletedTask;
        public Task RecordUsageAsync(string featureKey) => Task.CompletedTask;
        public Task RecordUsageAsync<TContext>(string featureKey, TContext context) => Task.CompletedTask;
        public Task RecordViewAsync(string featureKey) => Task.CompletedTask;
        public Task RecordViewAsync<TContext>(string featureKey, TContext context) => Task.CompletedTask;
    }
}

