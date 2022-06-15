using Grpc.Net.Client;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Toggly.Web;

namespace Toggly.FeatureManagement
{
    public class TogglyUsageStatsProvider : IFeatureUsageStatsProvider
    {
        private readonly string _appKey;

        private readonly string _environment;

        private readonly string _baseUrl;

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly ConcurrentDictionary<string, int> _stats = new ConcurrentDictionary<string, int>();

        private readonly Timer _timer;

        private readonly Timer _longTimer;

        private readonly IFeatureContextProvider? _contextProvider;

        private readonly string userAgent;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, HashSet<string>> _uniqueUsageMap = new ConcurrentDictionary<string, HashSet<string>>();

        public TogglyUsageStatsProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl!;
            _clientFactory = clientFactory;
            _contextProvider = (IFeatureContextProvider?)serviceProvider.GetService(typeof(IFeatureContextProvider));

            _logger = loggerFactory.CreateLogger<TogglyUsageStatsProvider>();

            _timer = new Timer((s) => SendStats().ConfigureAwait(false), null, new TimeSpan(0, 5, 0), new TimeSpan(0, 5, 0));
            _longTimer = new Timer((s) => ResetUsageMap().ConfigureAwait(false), null, new TimeSpan(1, 0, 0, 0), new TimeSpan(1, 0, 0, 0));
            applicationLifetime.ApplicationStopping.Register(() => SendStats().ConfigureAwait(false).GetAwaiter().GetResult());

            var version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
            userAgent = $"Toggly.FeatureManagement/{version}";
        }

        private async Task ResetUsageMap()
        {
            if (!_uniqueUsageMap.Any())
                return;

            _logger.LogTrace("Send remaining stats and clear unique usage map");
            await SendStats().ConfigureAwait(false);
            _uniqueUsageMap.Clear();
        }

        private async Task SendStats()
        {
            try
            {
                if (_stats.IsEmpty)
                {
                    _logger.LogTrace("Send stats - nothing to send");
                    return;
                }

                _logger.LogTrace("Sending stats");
                var currentTime = DateTime.UtcNow;

                using var httpClient = _clientFactory.CreateClient("toggly");
                using var channel = GrpcChannel.ForAddress(_baseUrl, new GrpcChannelOptions { HttpClient = httpClient });
                var client = new Usage.UsageClient(channel);
                var dataPacket = new FeatureStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(currentTime),
                    TotalUniqueUsers = _uniqueUsageMap.SelectMany(t => t.Value).GroupBy(t => t[1..]).Count()
                };

                foreach (var stat in _stats.ToList().GroupBy(t => t.Key[1..]))
                {
                    dataPacket.Stats.Add(new StatMessage
                    {
                        EnabledCount = stat.Any(s => s.Key.StartsWith('a')) ? stat.First(s => s.Key.StartsWith('a')).Value : 0,
                        DisabledCount = stat.Any(s => s.Key.StartsWith('d')) ? stat.First(s => s.Key.StartsWith('d')).Value : 0,
                        Feature = stat.Key,
                        UniqueContextIdentifierDisabledCount = _uniqueUsageMap.TryGetValue(stat.Key, out var uniqueDisabled) ? uniqueDisabled.Count(s => s?.StartsWith("a") ?? false) : 0,
                        UniqueContextIdentifierEnabledCount = _uniqueUsageMap.TryGetValue(stat.Key, out var uniqueEnabled) ? uniqueEnabled.Count(s => s?.StartsWith("d") ?? false) : 0,
                        UniqueRequestDisabledCount = stat.Any(s => s.Key.StartsWith('u')) ? stat.First(s => s.Key.StartsWith('u')).Value : 0,
                        UniqueRequestEnabledCount = stat.Any(s => s.Key.StartsWith('x')) ? stat.First(s => s.Key.StartsWith('x')).Value : 0,
                        UsedCount = stat.Any(s => s.Key.StartsWith('v')) ? stat.First(s => s.Key.StartsWith('v')).Value : 0,
                        UniqueUsersUsedCount = _uniqueUsageMap.TryGetValue(stat.Key, out var uniqueUsers) ? uniqueUsers.Count(s => s?.StartsWith("v") ?? false) : 0,
                    });
                }

                _stats.Clear();

                var grpcMetadata = new Grpc.Core.Metadata
                {
                    { "UA", userAgent }
                };

                var result = await client.SendStatsAsync(dataPacket, grpcMetadata).ConfigureAwait(false);

                if (result.FeatureCount != dataPacket.Stats.Count)
                    _logger.LogWarning("Feature count did not match. Possible data integrity issues");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending stats to toggly");
            }
        }

        public async Task RecordUsageAsync(string featureKey)
        {
            _logger.LogTrace("Record feature usage: {featureKey}", featureKey);

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd($"v{featureKey}", 0);
            } while (!_stats.TryUpdate($"v{featureKey}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(featureKey, new HashSet<string>());
                    currentUniqueValue.Add($"v{uniqueIdentifier}");
                }
            }
        }

        public async Task RecordUsageAsync<TContext>(string featureKey, TContext context)
        {
            _logger.LogTrace("Record feature usage: {featureKey}", featureKey);

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd($"v{featureKey}", 0);
            } while (!_stats.TryUpdate($"v{featureKey}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(featureKey, new HashSet<string>());
                    currentUniqueValue.Add($"v{uniqueIdentifier}");
                }
            }
        }

        public async Task RecordCheckAsync(string featureKey, bool allowed)
        {
            _logger.LogTrace("Record feature check: {featureKey}", featureKey);

            //record stats keyed by feature status
            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd(allowed ? $"a{featureKey}" : $"d{featureKey}", 0);
            } while (!_stats.TryUpdate(allowed ? $"a{featureKey}" : $"d{featureKey}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? $"x{featureKey}" : $"u{featureKey}", 0);
                    } while (!_stats.TryUpdate(allowed ? $"x{featureKey}" : $"u{featureKey}", currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(featureKey, new HashSet<string>());
                    currentUniqueValue.Add(allowed ? $"a{uniqueIdentifier}" : $"d{uniqueIdentifier}");
                }
            }
        }

        public async Task RecordUsageAsync<TContext>(string featureKey, TContext context, bool allowed)
        {
            _logger.LogTrace("Record feature check: {featureKey}", featureKey);

            //record stats keyed by feature status

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd(allowed ? $"a{featureKey}" : $"d{featureKey}", 0);
            } while (!_stats.TryUpdate(allowed ? $"a{featureKey}" : $"d{featureKey}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey, context).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? $"x{featureKey}" : $"u{featureKey}", 0);
                    } while (!_stats.TryUpdate(allowed ? $"x{featureKey}" : $"u{featureKey}", currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(featureKey, new HashSet<string>());
                    currentUniqueValue.Add(allowed ? $"a{uniqueIdentifier}" : $"d{uniqueIdentifier}");
                }
            }
        }
    }
}
