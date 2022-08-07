using ConcurrentCollections;
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

        private readonly ConcurrentDictionary<(string FeatureKey, StatType Type), int> _stats = new ConcurrentDictionary<(string, StatType), int>();

        private enum StatType : byte
        {
            Enabled,
            Disabled,
            UniqueRequestEnabled,
            UniqueRequestDisabled,
            Used
        }

        private readonly Timer _timer;

        private readonly Timer _longTimer;

        private readonly IFeatureContextProvider? _contextProvider;

        private readonly string userAgent;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageEnabledMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageDisabledMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageUsedMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        private readonly HashSet<string> _uniqueUserMap = new HashSet<string>();

        public TogglyUsageStatsProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl ?? "https://app.toggly.io/";
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
            if (!_uniqueUsageEnabledMap.Any() && !_uniqueUsageDisabledMap.Any() && !_uniqueUsageUsedMap.Any())
                return;

            _logger.LogTrace("Send remaining stats and clear unique usage map");
            await SendStats().ConfigureAwait(false);
            _uniqueUsageEnabledMap.Clear();
            _uniqueUsageDisabledMap.Clear();
            _uniqueUsageUsedMap.Clear();
            _uniqueUserMap.Clear();
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
                    TotalUniqueUsers = _uniqueUserMap.Count
                };

                var keys = _stats.Keys.Select(t => t.FeatureKey).ToArray().Distinct().ToArray();
                for (int i = 0; i < keys.Length; i++)
                {
                    dataPacket.Stats.Add(new StatMessage
                    {
                        EnabledCount = _stats.TryGetValue((keys[i], StatType.Enabled), out var enabledCount) ? enabledCount : 0,
                        DisabledCount = _stats.TryGetValue((keys[i], StatType.Disabled), out var disabledCount) ? disabledCount : 0,
                        Feature = keys[i],
                        UniqueContextIdentifierDisabledCount = _uniqueUsageEnabledMap.TryGetValue(keys[i], out var uniqueIdDisabledCount) ? uniqueIdDisabledCount.Count : 0,
                        UniqueContextIdentifierEnabledCount = _uniqueUsageEnabledMap.TryGetValue(keys[i], out var uniqueIdEnabledCount) ? uniqueIdEnabledCount.Count : 0,
                        UniqueRequestDisabledCount = _stats.TryGetValue((keys[i], StatType.UniqueRequestDisabled), out var uniqueDisabledCount) ? uniqueDisabledCount : 0,
                        UniqueRequestEnabledCount = _stats.TryGetValue((keys[i], StatType.UniqueRequestEnabled), out var uniqueEnabledCount) ? uniqueEnabledCount : 0,
                        UsedCount = _stats.TryGetValue((keys[i], StatType.Used), out var usedCount) ? usedCount : 0,
                        UniqueUsersUsedCount = _uniqueUsageUsedMap.TryGetValue(keys[i], out var uniqueIdUsedCount) ? uniqueIdUsedCount.Count : 0,
                    });
                }

                _stats.Clear();

                var grpcMetadata = new Grpc.Core.Metadata
                {
                    { "UA", userAgent }
                };

                var result = await client.SendStatsAsync(dataPacket, grpcMetadata, DateTime.UtcNow.AddSeconds(30)).ConfigureAwait(false);

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
                currentValue = _stats.GetOrAdd((featureKey, StatType.Used), 0);
            } while (!_stats.TryUpdate((featureKey, StatType.Used), currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageUsedMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>());
                    currentUniqueValue.Add(GetDeterministicHashCode(uniqueIdentifier));
                    _uniqueUserMap.Add(uniqueIdentifier);
                }
            }
        }

        public async Task RecordUsageAsync<TContext>(string featureKey, TContext context)
        {
            _logger.LogTrace("Record feature usage: {featureKey}", featureKey);

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd((featureKey, StatType.Used), 0);
            } while (!_stats.TryUpdate((featureKey, StatType.Used), currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageUsedMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>());
                    currentUniqueValue.Add(GetDeterministicHashCode(uniqueIdentifier));
                    _uniqueUserMap.Add(uniqueIdentifier);
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
                currentValue = _stats.GetOrAdd(allowed ? (featureKey, StatType.Enabled) : (featureKey, StatType.Disabled), 0);
            } while (!_stats.TryUpdate(allowed ? (featureKey, StatType.Enabled) : (featureKey, StatType.Disabled), currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? (featureKey, StatType.UniqueRequestEnabled) : (featureKey, StatType.UniqueRequestDisabled), 0);
                    } while (!_stats.TryUpdate(allowed ? (featureKey, StatType.UniqueRequestEnabled) : (featureKey, StatType.UniqueRequestDisabled), currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    if (allowed)
                        _uniqueUsageEnabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
                    else
                        _uniqueUsageDisabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
                    _uniqueUserMap.Add(uniqueIdentifier);
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
                currentValue = _stats.GetOrAdd(allowed ? (featureKey, StatType.Enabled) : (featureKey, StatType.Disabled), 0);
            } while (!_stats.TryUpdate(allowed ? (featureKey, StatType.Enabled) : (featureKey, StatType.Disabled), currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey, context).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? (featureKey, StatType.UniqueRequestEnabled) : (featureKey, StatType.UniqueRequestDisabled), 0);
                    } while (!_stats.TryUpdate(allowed ? (featureKey, StatType.UniqueRequestEnabled) : (featureKey, StatType.UniqueRequestDisabled), currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    if (allowed)
                        _uniqueUsageEnabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
                    else
                        _uniqueUsageDisabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
                    _uniqueUserMap.Add(uniqueIdentifier);
                }
            }
        }

        static int GetDeterministicHashCode(string str)
        {
            unchecked
            {
                int hash1 = (5381 << 16) + 5381;
                int hash2 = hash1;

                for (int i = 0; i < str.Length; i += 2)
                {
                    hash1 = ((hash1 << 5) + hash1) ^ str[i];
                    if (i == str.Length - 1)
                        break;
                    hash2 = ((hash2 << 5) + hash2) ^ str[i + 1];
                }

                return hash1 + (hash2 * 1566083941);
            }
        }
    }
}
