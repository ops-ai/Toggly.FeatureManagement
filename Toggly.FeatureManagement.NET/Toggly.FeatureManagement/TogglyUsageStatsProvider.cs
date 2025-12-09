using ConcurrentCollections;
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
    public class TogglyUsageStatsProvider : IFeatureUsageStatsProvider, IUsageStatsDebug, IDisposable
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
        
        /// <summary>
        /// Tracks unique user ID hashes (int) seen since last send, keyed by feature name.
        /// Incremental list that gets cleared after successful send to prevent unbounded growth.
        /// Used for monthly unique user tracking with server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUserHashesSinceLastSend = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        
        /// <summary>
        /// Tracks unique user ID hashes (int) at the application level, regardless of feature usage.
        /// Incremental list that gets cleared after successful send to prevent unbounded growth.
        /// Used for monthly unique user tracking with server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        private readonly ConcurrentHashSet<int> _applicationUniqueUserHashesSinceLastSend = new ConcurrentHashSet<int>();
        
        /// <summary>
        /// Maximum number of unique user hashes to track per feature before forcing an early send.
        /// Prevents memory issues in high-traffic scenarios.
        /// </summary>
        private const int MaxUniqueUserHashesPerFeature = 10000;
        
        /// <summary>
        /// Maximum number of unique user hashes to track at application level before forcing an early send.
        /// Prevents memory issues in high-traffic scenarios.
        /// </summary>
        private const int MaxApplicationUniqueUserHashes = 10000;
        
        private readonly SemaphoreSlim _sendStatsSemaphore = new SemaphoreSlim(1, 1);

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

            _timer = new Timer(TimerCallback, null, new TimeSpan(0, 1, 0), new TimeSpan(0, 1, 0));
            _longTimer = new Timer(LongTimerCallback, null, new TimeSpan(1, 0, 0, 0), new TimeSpan(1, 0, 0, 0));
            applicationLifetime.ApplicationStopping.Register(() =>
            {
                // Fire and forget with timeout - we can't block shutdown indefinitely
                _ = Task.Run(async () =>
                {
                    try
                    {
                        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                        await Task.WhenAny(SendStats(), Task.Delay(TimeSpan.FromSeconds(30), cts.Token)).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error sending stats during shutdown");
                    }
                });
            });

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

        private volatile string _lastError = string.Empty;
        private DateTime? _lastErrorTime = null;
        private DateTime? _lastSend = null;

        private void TimerCallback(object? state)
        {
            // Fire and forget with proper error handling
            _ = Task.Run(async () =>
            {
                try
                {
                    await SendStats().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in timer callback while sending stats");
                }
            });
        }

        private void LongTimerCallback(object? state)
        {
            // Fire and forget with proper error handling
            _ = Task.Run(async () =>
            {
                try
                {
                    await ResetUsageMap().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in long timer callback while resetting usage map");
                }
            });
        }
        
        private async Task SendStats()
        {
            // Prevent concurrent send operations (timer, longTimer, and ApplicationStopping could overlap)
            if (!await _sendStatsSemaphore.WaitAsync(0).ConfigureAwait(false))
            {
                _logger.LogDebug("SendStats already in progress, skipping");
                return;
            }

            // Declare variables outside try block so they're accessible in catch
            Dictionary<(string FeatureKey, byte Type), int>? stats = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageEnabledMap = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageDisabledMap = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageUsedMap = null;
            Dictionary<string, List<int>>? uniqueUserHashesToSend = null;
            List<int>? applicationUniqueUserHashesToSend = null;

            try
            {
                if (_stats.IsEmpty && _uniqueUserHashesSinceLastSend.IsEmpty && _applicationUniqueUserHashesSinceLastSend.IsEmpty)
                {
                    _logger.LogTrace("Send stats - nothing to send");
                    return;
                }

                // Clone stats and uniqueUsage maps
                stats = new Dictionary<(string FeatureKey, byte Type), int>(_stats);
                _stats.Clear();
                uniqueUsageEnabledMap = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageEnabledMap);
                _uniqueUsageEnabledMap.Clear();
                uniqueUsageDisabledMap = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageDisabledMap);
                _uniqueUsageDisabledMap.Clear();
                uniqueUsageUsedMap = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageUsedMap);
                _uniqueUsageUsedMap.Clear();
                
                // Clone unique user hashes for monthly tracking (incremental since last send)
                uniqueUserHashesToSend = new Dictionary<string, List<int>>();
                foreach (var kvp in _uniqueUserHashesSinceLastSend)
                {
                    if (kvp.Value.Count > 0)
                    {
                        uniqueUserHashesToSend[kvp.Key] = kvp.Value.ToList();
                    }
                }
                _uniqueUserHashesSinceLastSend.Clear();
                
                // Clone application-level unique user hashes for monthly tracking (incremental since last send)
                if (_applicationUniqueUserHashesSinceLastSend.Count > 0)
                {
                    applicationUniqueUserHashesToSend = _applicationUniqueUserHashesSinceLastSend.ToList();
                    _applicationUniqueUserHashesSinceLastSend.Clear();
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

                // Get all feature keys (from stats and unique user hashes)
                var featureKeysFromStats = stats.Keys.Select(t => t.FeatureKey).Distinct().ToList();
                var featureKeysFromHashes = uniqueUserHashesToSend.Keys.ToList();
                var allFeatureKeys = featureKeysFromStats.Union(featureKeysFromHashes).Distinct().ToList();
                
                for (int i = 0; i < allFeatureKeys.Count; i++)
                {
                    var featureKey = allFeatureKeys[i];
                    var statMessage = new StatMessage
                    {
                        EnabledCount = stats.TryGetValue((featureKey, (byte)StatType.Enabled), out var enabledCount) ? enabledCount : 0,
                        DisabledCount = stats.TryGetValue((featureKey, (byte)StatType.Disabled), out var disabledCount) ? disabledCount : 0,
                        Feature = featureKey,
                        // Use correct maps for enabled vs disabled
                        UniqueContextIdentifierEnabledCount = uniqueUsageEnabledMap.TryGetValue(featureKey, out var uniqueIdEnabledCount) ? uniqueIdEnabledCount.Count : 0,
                        UniqueContextIdentifierDisabledCount = uniqueUsageDisabledMap.TryGetValue(featureKey, out var uniqueIdDisabledCount) ? uniqueIdDisabledCount.Count : 0,
                        UniqueRequestEnabledCount = stats.TryGetValue((featureKey, (byte)StatType.UniqueRequestEnabled), out var uniqueEnabledCount) ? uniqueEnabledCount : 0,
                        UniqueRequestDisabledCount = stats.TryGetValue((featureKey, (byte)StatType.UniqueRequestDisabled), out var uniqueDisabledCount) ? uniqueDisabledCount : 0,
                        UsedCount = stats.TryGetValue((featureKey, (byte)StatType.Used), out var usedCount) ? usedCount : 0,
                        UniqueUsersUsedCount = uniqueUsageUsedMap.TryGetValue(featureKey, out var uniqueUsedCount) ? uniqueUsedCount.Count : 0
                    };
                    
                    // Add unique user hashes for monthly tracking (incremental since last send)
                    if (uniqueUserHashesToSend != null && uniqueUserHashesToSend.TryGetValue(featureKey, out var hashes))
                    {
                        statMessage.UniqueUserHashes.AddRange(hashes);
                    }
                    
                    dataPacket.Stats.Add(statMessage);
                }
                
                // Add application-level unique user hashes for monthly tracking (incremental since last send)
                if (applicationUniqueUserHashesToSend != null && applicationUniqueUserHashesToSend.Count > 0)
                {
                    dataPacket.UniqueUserHashes.AddRange(applicationUniqueUserHashesToSend);
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

                // Restore stats on error (only if we successfully cloned them)
                if (stats != null)
                {
                    foreach (var stat in stats)
                        _stats.AddOrUpdate(stat.Key, stat.Value, (_, oldValue) => oldValue + stat.Value);
                }

                // Restore unique usage maps on error
                if (uniqueUsageEnabledMap != null)
                {
                    foreach (var u in uniqueUsageEnabledMap)
                        _uniqueUsageEnabledMap.AddOrUpdate(u.Key, u.Value, (_, oldValue) => new ConcurrentHashSet<int>(u.Value.Union(oldValue)));
                }

                if (uniqueUsageDisabledMap != null)
                {
                    foreach (var u in uniqueUsageDisabledMap)
                        _uniqueUsageDisabledMap.AddOrUpdate(u.Key, u.Value, (_, oldValue) => new ConcurrentHashSet<int>(u.Value.Union(oldValue)));
                }

                if (uniqueUsageUsedMap != null)
                {
                    foreach (var u in uniqueUsageUsedMap)
                        _uniqueUsageUsedMap.AddOrUpdate(u.Key, u.Value, (_, oldValue) => new ConcurrentHashSet<int>(u.Value.Union(oldValue)));
                }

                // Restore unique user hashes on error
                if (uniqueUserHashesToSend != null)
                {
                    foreach (var kvp in uniqueUserHashesToSend)
                    {
                        var hashSet = _uniqueUserHashesSinceLastSend.GetOrAdd(kvp.Key, _ => new ConcurrentHashSet<int>());
                        foreach (var hash in kvp.Value)
                        {
                            hashSet.Add(hash);
                        }
                    }
                }
                
                // Restore application-level unique user hashes on error
                if (applicationUniqueUserHashesToSend != null)
                {
                    foreach (var hash in applicationUniqueUserHashesToSend)
                    {
                        _applicationUniqueUserHashesSinceLastSend.Add(hash);
                    }
                }

                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
            }
            finally
            {
                _sendStatsSemaphore.Release();
            }
        }

        /// <inheritdoc/>
        public async Task RecordUsageAsync(string featureKey)
        {
            _logger.LogTrace("Record feature usage: {featureKey}", featureKey);

            // Use AddOrUpdate with lambda for atomic increment - prevents race condition with SendStats
            _stats.AddOrUpdate(
                (featureKey, (byte)StatType.Used),
                1, // Add: if key doesn't exist, set to 1
                (key, existingValue) => existingValue + 1); // Update: if key exists, increment

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageUsedMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>());
                    currentUniqueValue.Add(GetDeterministicHashCode(uniqueIdentifier));
                    
                    // Track user ID for monthly unique user tracking (incremental)
                    RecordUniqueUserId(featureKey, uniqueIdentifier);
                    
                    // Track user ID at application level for monthly unique user tracking (incremental)
                    RecordApplicationUniqueUserId(uniqueIdentifier);
                }
            }
        }

        /// <inheritdoc/>
        public async Task RecordUsageAsync<TContext>(string featureKey, TContext context)
        {
            _logger.LogTrace("Record feature usage: {featureKey}", featureKey);

            // Use AddOrUpdate with lambda for atomic increment - prevents race condition with SendStats
            _stats.AddOrUpdate(
                (featureKey, (byte)StatType.Used),
                1, // Add: if key doesn't exist, set to 1
                (key, existingValue) => existingValue + 1); // Update: if key exists, increment

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageUsedMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>());
                    currentUniqueValue.Add(GetDeterministicHashCode(uniqueIdentifier));
                    
                    // Track user ID for monthly unique user tracking (incremental)
                    RecordUniqueUserId(featureKey, uniqueIdentifier);
                    
                    // Track user ID at application level for monthly unique user tracking (incremental)
                    RecordApplicationUniqueUserId(uniqueIdentifier);
                }
            }
        }

        /// <inheritdoc/>
        public async Task RecordCheckAsync(string featureKey, bool allowed)
        {
            _logger.LogTrace("Record feature check: {featureKey}", featureKey);

            // Record stats keyed by feature status - use atomic AddOrUpdate
            var statKey = allowed ? (featureKey, (byte)StatType.Enabled) : (featureKey, (byte)StatType.Disabled);
            _stats.AddOrUpdate(
                statKey,
                1, // Add: if key doesn't exist, set to 1
                (key, existingValue) => existingValue + 1); // Update: if key exists, increment

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    var uniqueRequestKey = allowed ? (featureKey, (byte)StatType.UniqueRequestEnabled) : (featureKey, (byte)StatType.UniqueRequestDisabled);
                    _stats.AddOrUpdate(
                        uniqueRequestKey,
                        1,
                        (key, existingValue) => existingValue + 1);
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var hash = GetDeterministicHashCode(uniqueIdentifier);
                    if (allowed)
                        _uniqueUsageEnabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(hash);
                    else
                        _uniqueUsageDisabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(hash);
                    
                    // Track user ID at application level for monthly unique user tracking (incremental)
                    RecordApplicationUniqueUserId(uniqueIdentifier);
                }
            }
        }

        /// <inheritdoc/>
        public async Task RecordUsageAsync<TContext>(string featureKey, TContext context, bool allowed)
        {
            _logger.LogTrace("Record feature check: {featureKey}", featureKey);

            // Record stats keyed by feature status - use atomic AddOrUpdate
            var statKey = allowed ? (featureKey, (byte)StatType.Enabled) : (featureKey, (byte)StatType.Disabled);
            _stats.AddOrUpdate(
                statKey,
                1, // Add: if key doesn't exist, set to 1
                (key, existingValue) => existingValue + 1); // Update: if key exists, increment

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(featureKey, context).ConfigureAwait(false);
                if (!usedInRequest)
                {
                    var uniqueRequestKey = allowed ? (featureKey, (byte)StatType.UniqueRequestEnabled) : (featureKey, (byte)StatType.UniqueRequestDisabled);
                    _stats.AddOrUpdate(
                        uniqueRequestKey,
                        1,
                        (key, existingValue) => existingValue + 1);
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var hash = GetDeterministicHashCode(uniqueIdentifier);
                    if (allowed)
                        _uniqueUsageEnabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(hash);
                    else
                        _uniqueUsageDisabledMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>()).Add(hash);
                    
                    // Track user ID at application level for monthly unique user tracking (incremental)
                    RecordApplicationUniqueUserId(uniqueIdentifier);
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

        /// <summary>
        /// Record a unique user ID hash for a feature when the feature is actually used (usedCount).
        /// Used for monthly unique user tracking. The user ID is based on uniqueContextIdentifier from IFeatureContextProvider.
        /// The user ID is hashed and tracked incrementally (since last send) and sent to Toggly for server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        /// <param name="featureKey">The feature key to track unique users for</param>
        /// <param name="userId">The unique user identifier from uniqueContextIdentifier (e.g., email, username, user ID)</param>
        private void RecordUniqueUserId(string featureKey, string userId)
        {
            if (string.IsNullOrWhiteSpace(featureKey) || string.IsNullOrWhiteSpace(userId))
                return;

            var hash = GetDeterministicHashCode(userId);
            var hashSet = _uniqueUserHashesSinceLastSend.GetOrAdd(featureKey, _ => new ConcurrentHashSet<int>());
            
            // Check size limit to prevent unbounded growth
            if (hashSet.Count >= MaxUniqueUserHashesPerFeature)
            {
                _logger.LogWarning("Unique user hash limit reached for feature {FeatureKey}. Consider sending more frequently or increasing limit.", featureKey);
                // Still try to add, but log warning
            }
            
            hashSet.Add(hash);
        }
        
        /// <summary>
        /// Record a unique user ID hash at the application level (regardless of feature usage).
        /// Used for monthly unique user tracking. The user ID is based on uniqueContextIdentifier from IFeatureContextProvider.
        /// The user ID is hashed and tracked incrementally (since last send) and sent to Toggly for server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        /// <param name="userId">The unique user identifier from uniqueContextIdentifier (e.g., email, username, user ID)</param>
        private void RecordApplicationUniqueUserId(string userId)
        {
            if (string.IsNullOrWhiteSpace(userId))
                return;

            var hash = GetDeterministicHashCode(userId);
            
            // Check size limit to prevent unbounded growth
            if (_applicationUniqueUserHashesSinceLastSend.Count >= MaxApplicationUniqueUserHashes)
            {
                _logger.LogWarning("Application-level unique user hash limit reached. Consider sending more frequently or increasing limit.");
                // Still try to add, but log warning
            }
            
            _applicationUniqueUserHashesSinceLastSend.Add(hash);
        }

        /// <inheritdoc/>
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

        /// <summary>
        /// Dispose the usage stats provider
        /// </summary>
        public void Dispose()
        {
            _timer?.Dispose();
            _longTimer?.Dispose();
            _sendStatsSemaphore?.Dispose();
        }
    }

    public class UsageStatsDebugInfo
    {
        /// <summary>
        /// App key
        /// </summary>
        public string? AppKey { get; set; }

        /// <summary>
        /// Environment name
        /// </summary>
        public string? Environment { get; set; }

        /// <summary>
        /// Base URL for the Toggly API
        /// </summary>
        public string? BaseUrl { get; set; }

        //public ConcurrentDictionary<(string FeatureKey, byte Type), int>? Stats { get; set; }

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        public ConcurrentDictionary<string, ConcurrentHashSet<int>>? UniqueUsageEnabledMap { get; set; }

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        public ConcurrentDictionary<string, ConcurrentHashSet<int>>? UniqueUsageDisabledMap { get; set; }

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        public ConcurrentDictionary<string, ConcurrentHashSet<int>>? UniqueUsageUsedMap { get; set; }

        /// <summary>
        /// User agent
        /// </summary>
        public string? UserAgent { get; set; }

        /// <summary>
        /// Last error
        /// </summary>
        public string? LastError { get; set; }

        /// <summary>
        /// Last error time
        /// </summary>
        public DateTime? LastErrorTime { get; set; }

        /// <summary>
        /// Last send
        /// </summary>
        public DateTime? LastSend { get; set; }
    }
}
