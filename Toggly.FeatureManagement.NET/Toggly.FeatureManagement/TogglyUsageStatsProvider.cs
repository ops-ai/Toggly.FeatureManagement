﻿using ConcurrentCollections;
using Grpc.Core;
using Grpc.Net.Client;
using Grpc.Net.Client.Configuration;
using Grpc.Net.Client.Web;
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
    public class TogglyUsageStatsProvider : IFeatureUsageStatsProvider, IUsageStatsDebug
    {
        private readonly string _appKey;

        private readonly string _environment;

        private readonly string _baseUrl;

        private readonly ILogger _logger;

        private readonly IHttpClientFactory _clientFactory;

        private readonly ConcurrentDictionary<(string FeatureKey, byte Type), int> _stats = new ConcurrentDictionary<(string, byte), int>();

        public enum StatType : byte
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

        private readonly string? appVersion;

        private readonly DateTime? processStartTime;

        private readonly string? appInstanceName;

        private readonly Usage.UsageClient _usageClient;

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageEnabledMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageDisabledMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageUsedMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        private readonly HashSet<string> _uniqueUserMap = new HashSet<string>();

        public TogglyUsageStatsProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider, Usage.UsageClient usageClient)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl ?? "https://app.toggly.io/";
            _clientFactory = clientFactory;
            _contextProvider = (IFeatureContextProvider?)serviceProvider.GetService(typeof(IFeatureContextProvider));
            _usageClient = usageClient;

            appVersion = togglySettings.Value.AppVersion ?? Assembly.GetEntryAssembly()?.GetName().Version?.ToString();
            appInstanceName = togglySettings.Value.InstanceName ?? Environment.MachineName;
            try
            {
                var currentProcess = System.Diagnostics.Process.GetCurrentProcess();
                processStartTime = currentProcess.StartTime.ToUniversalTime();
            }
            catch { }

            _logger = loggerFactory.CreateLogger<TogglyUsageStatsProvider>();

            _timer = new Timer((s) => SendStats().ConfigureAwait(false), null, new TimeSpan(0, 1, 0), new TimeSpan(0, 1, 0));
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
        }

        private string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastSend = null;

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
                
                var dataPacket = new FeatureStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(currentTime),
                    TotalUniqueUsers = 0,
                    AppVersion = appVersion,
                    InstanceName = appInstanceName
                };
                if (processStartTime.HasValue)
                    dataPacket.ProcessStartTime = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(processStartTime.Value);

                var keys = _stats.Keys.Select(t => t.FeatureKey).ToArray().Distinct().ToArray();
                for (int i = 0; i < keys.Length; i++)
                {
                    dataPacket.Stats.Add(new StatMessage
                    {
                        EnabledCount = _stats.TryRemove((keys[i], (byte)StatType.Enabled), out var enabledCount) ? enabledCount : 0,
                        DisabledCount = _stats.TryRemove((keys[i], (byte)StatType.Disabled), out var disabledCount) ? disabledCount : 0,
                        Feature = keys[i],
                        UniqueContextIdentifierDisabledCount = _uniqueUsageEnabledMap.TryRemove(keys[i], out var uniqueIdDisabledCount) ? uniqueIdDisabledCount.Count : 0,
                        UniqueContextIdentifierEnabledCount = _uniqueUsageEnabledMap.TryRemove(keys[i], out var uniqueIdEnabledCount) ? uniqueIdEnabledCount.Count : 0,
                        UniqueRequestDisabledCount = _stats.TryRemove((keys[i], (byte)StatType.UniqueRequestDisabled), out var uniqueDisabledCount) ? uniqueDisabledCount : 0,
                        UniqueRequestEnabledCount = _stats.TryRemove((keys[i], (byte)StatType.UniqueRequestEnabled), out var uniqueEnabledCount) ? uniqueEnabledCount : 0,
                        UsedCount = _stats.TryRemove((keys[i], (byte)StatType.Used), out var usedCount) ? usedCount : 0,
                        UniqueUsersUsedCount = 0
                    });
                }

                var grpcMetadata = new Metadata
                {
                    { "UA", userAgent }
                };

                var result = await _usageClient.SendStatsAsync(dataPacket, grpcMetadata, DateTime.UtcNow.AddSeconds(180)).ConfigureAwait(false);

                if (result.FeatureCount != dataPacket.Stats.Count)
                    _logger.LogWarning("Feature count did not match. Possible data integrity issues");
                
                _lastSend = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending stats to toggly");
                
                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
            }
        }

        public async Task RecordUsageAsync(string featureKey)
        {
            _logger.LogTrace("Record feature usage: {featureKey}", featureKey);

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd((featureKey, (byte)StatType.Used), 0);
            } while (!_stats.TryUpdate((featureKey, (byte)StatType.Used), currentValue + 1, currentValue));

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
                currentValue = _stats.GetOrAdd((featureKey, (byte)StatType.Used), 0);
            } while (!_stats.TryUpdate((featureKey, (byte)StatType.Used), currentValue + 1, currentValue));

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
                currentValue = _stats.GetOrAdd(allowed ? (featureKey, (byte)StatType.Enabled) : (featureKey, (byte)StatType.Disabled), 0);
            } while (!_stats.TryUpdate(allowed ? (featureKey, (byte)StatType.Enabled) : (featureKey, (byte)StatType.Disabled), currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? (featureKey, (byte)StatType.UniqueRequestEnabled) : (featureKey, (byte)StatType.UniqueRequestDisabled), 0);
                    } while (!_stats.TryUpdate(allowed ? (featureKey, (byte)StatType.UniqueRequestEnabled) : (featureKey, (byte)StatType.UniqueRequestDisabled), currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    if (allowed)
                        _uniqueUsageEnabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
                    else
                        _uniqueUsageDisabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
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
                currentValue = _stats.GetOrAdd(allowed ? (featureKey, (byte)StatType.Enabled) : (featureKey, (byte)StatType.Disabled), 0);
            } while (!_stats.TryUpdate(allowed ? (featureKey, (byte)StatType.Enabled) : (featureKey, (byte)StatType.Disabled), currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey, context).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? (featureKey, (byte)StatType.UniqueRequestEnabled) : (featureKey, (byte)StatType.UniqueRequestDisabled), 0);
                    } while (!_stats.TryUpdate(allowed ? (featureKey, (byte)StatType.UniqueRequestEnabled) : (featureKey, (byte)StatType.UniqueRequestDisabled), currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    if (allowed)
                        _uniqueUsageEnabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
                    else
                        _uniqueUsageDisabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(GetDeterministicHashCode(uniqueIdentifier));
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

        public UsageStatsDebugInfo GetDebugInfo()
        {
            return new UsageStatsDebugInfo
            {
                AppKey = _appKey,
                BaseUrl = _baseUrl,
                Environment = _environment,
                //Stats = _stats,
                UniqueUsageEnabledMap = _uniqueUsageEnabledMap,
                UniqueUsageDisabledMap = _uniqueUsageDisabledMap,
                UniqueUsageUsedMap = _uniqueUsageUsedMap,
                UserAgent = userAgent,
                LastError = _lastError,
                LastErrorTime = _lastErrorTime,
                LastSend = _lastSend
            };
        }
    }

    public class UsageStatsDebugInfo
    {
        public string? AppKey { get; set; }

        public string? Environment { get; set; }

        public string? BaseUrl { get; set; }

        //public ConcurrentDictionary<(string FeatureKey, byte Type), int>? Stats { get; set; }

        public ConcurrentDictionary<string, ConcurrentHashSet<int>>? UniqueUsageEnabledMap { get; set; }

        public ConcurrentDictionary<string, ConcurrentHashSet<int>>? UniqueUsageDisabledMap { get; set; }

        public ConcurrentDictionary<string, ConcurrentHashSet<int>>? UniqueUsageUsedMap { get; set; }

        public string? UserAgent { get; set; }

        public string? LastError { get; set; }

        public DateTime? LastErrorTime { get; set; }

        public DateTime? LastSend { get; set; }
    }
}
