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

        private readonly ConcurrentDictionary<(string FeatureKey, byte Type), int> _stats = new ConcurrentDictionary<(string, byte), int>();

        public enum StatType : byte
        {
            Enabled,
            Disabled,
            UniqueRequestEnabled,
            UniqueRequestDisabled,
            Used,
            Viewed
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
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUsageViewedMap = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        
        /// <summary>
        /// Tracks unique user ID hashes (int) who USED features since last send, keyed by feature name.
        /// Incremental list that gets cleared after successful send to prevent unbounded growth.
        /// Used for monthly unique user tracking with server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueUserHashesSinceLastSend = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        
        /// <summary>
        /// Tracks unique user ID hashes (int) who VIEWED/CHECKED features since last send, keyed by feature name.
        /// Incremental list that gets cleared after successful send to prevent unbounded growth.
        /// Used for monthly unique user tracking with server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        private readonly ConcurrentDictionary<string, ConcurrentHashSet<int>> _uniqueViewedUserHashesSinceLastSend = new ConcurrentDictionary<string, ConcurrentHashSet<int>>();
        
        /// <summary>
        /// Tracks unique user ID hashes (int) at the application level, regardless of feature usage.
        /// Incremental list that gets cleared after successful send to prevent unbounded growth.
        /// Used for monthly unique user tracking with server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        private readonly ConcurrentHashSet<int> _applicationUniqueUserHashesSinceLastSend = new ConcurrentHashSet<int>();

        /// <summary>
        /// Pending definition-refresh cache hits since last successful SendStats (batch delta).
        /// </summary>
        private int _definitionCacheHits;

        /// <summary>
        /// Pending definition-refresh cache misses since last successful SendStats (batch delta).
        /// </summary>
        private int _definitionCacheMisses;
        
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

        /// <summary>
        /// Serializes unique-user hash Add and snapshot-and-clear so SendStats does not
        /// call ConcurrentHashSet.ToList while evaluations mutate the same set.
        /// </summary>
        private readonly object _uniqueHashLock = new object();

        private volatile bool _disposed = false;
        private volatile bool _shuttingDown = false;

        public TogglyUsageStatsProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider, Usage.UsageClient usageClient)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.ResolveMetricsBaseUrl();
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
            applicationLifetime.ApplicationStopping.Register(OnApplicationStopping);

            // Must match platform SdkUserAgentParser (`toggly-{sdk}/{version}`) and HTTP defs UA.
            userAgent = TogglySdkIdentity.UserAgent;
        }

        private void OnApplicationStopping()
        {
            _shuttingDown = true;
            
            // Stop the timers immediately to prevent new callbacks
            _timer.Change(Timeout.Infinite, Timeout.Infinite);
            _longTimer.Change(Timeout.Infinite, Timeout.Infinite);
            
            // Send stats synchronously during shutdown to avoid async/dispose race conditions
            try
            {
                // Use a synchronous wait with timeout
                var sendTask = SendStats(suppressLogging: true);
                sendTask.Wait(TimeSpan.FromSeconds(30));
            }
            catch (AggregateException ae)
            {
                // Swallow exceptions during shutdown - logger may already be disposed
                foreach (var ex in ae.Flatten().InnerExceptions)
                {
                    TryLog(LogLevel.Error, ex, "Error sending stats during shutdown");
                }
            }
            catch (Exception ex)
            {
                TryLog(LogLevel.Error, ex, "Error sending stats during shutdown");
            }
        }

        /// <summary>
        /// Safely attempts to log, handling cases where the logger may be disposed
        /// </summary>
        private void TryLog(LogLevel level, string message, params object[] args)
        {
            if (_disposed) return;
            
            try
            {
                _logger.Log(level, message, args);
            }
            catch (ObjectDisposedException)
            {
                // Logger factory was disposed, ignore
            }
        }

        /// <summary>
        /// Safely attempts to log an exception, handling cases where the logger may be disposed
        /// </summary>
        private void TryLog(LogLevel level, Exception? exception, string message, params object[] args)
        {
            if (_disposed) return;
            
            try
            {
                _logger.Log(level, exception, message, args);
            }
            catch (ObjectDisposedException)
            {
                // Logger factory was disposed, ignore
            }
        }

        private async Task ResetUsageMap()
        {
            if (!_uniqueUsageEnabledMap.Any() && !_uniqueUsageDisabledMap.Any() && !_uniqueUsageUsedMap.Any())
                return;

            TryLog(LogLevel.Trace, "Send remaining stats and clear unique usage map");
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
            // Skip if shutting down or disposed
            if (_shuttingDown || _disposed) return;
            
            // Fire and forget with proper error handling
            _ = Task.Run(async () =>
            {
                try
                {
                    await SendStats().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    TryLog(LogLevel.Error, ex, "Error in timer callback while sending stats");
                }
            });
        }

        private void LongTimerCallback(object? state)
        {
            // Skip if shutting down or disposed
            if (_shuttingDown || _disposed) return;
            
            // Fire and forget with proper error handling
            _ = Task.Run(async () =>
            {
                try
                {
                    await ResetUsageMap().ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    TryLog(LogLevel.Error, ex, "Error in long timer callback while resetting usage map");
                }
            });
        }
        
        private Task SendStats() => SendStats(suppressLogging: false);

        private async Task SendStats(bool suppressLogging)
        {
            // Timers and application shutdown share the same single in-flight send.
            if (!await _sendStatsSemaphore.WaitAsync(0).ConfigureAwait(false))
            {
                if (!suppressLogging) TryLog(LogLevel.Debug, "SendStats already in progress, skipping");
                return;
            }

            UsageStatsBatch? batch = null;
            try
            {
                if (!HasPendingStats())
                {
                    if (!suppressLogging) TryLog(LogLevel.Trace, "Send stats - nothing to send");
                    return;
                }

                batch = CaptureBatch();
                if (!suppressLogging) TryLog(LogLevel.Trace, "Sending stats");
                var dataPacket = CreateDataPacket(batch);
                var grpcMetadata = new Metadata { { "UA", userAgent } };
                var result = await _usageClient.SendStatsAsync(dataPacket, grpcMetadata, DateTime.UtcNow.AddSeconds(180)).ConfigureAwait(false);
                if (result.FeatureCount != dataPacket.Stats.Count && !suppressLogging)
                    TryLog(LogLevel.Warning, "Feature count did not match. Possible data integrity issues");
                _lastSend = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                if (!suppressLogging) TryLog(LogLevel.Error, ex, "Error sending stats to toggly");
                if (batch != null) RestoreBatch(batch);
                _lastError = ex.Message;
                _lastErrorTime = DateTime.UtcNow;
            }
            finally
            {
                _sendStatsSemaphore.Release();
            }
        }

        private bool HasPendingStats()
        {
            var pendingCacheHits = Volatile.Read(ref _definitionCacheHits);
            var pendingCacheMisses = Volatile.Read(ref _definitionCacheMisses);
            return !_stats.IsEmpty || !_uniqueUserHashesSinceLastSend.IsEmpty || !_uniqueViewedUserHashesSinceLastSend.IsEmpty
                || !_applicationUniqueUserHashesSinceLastSend.IsEmpty || pendingCacheHits != 0 || pendingCacheMisses != 0;
        }

        private UsageStatsBatch CaptureBatch()
        {
            var batch = new UsageStatsBatch();
            try
            {
                // Keep the capture/clear order and retain each completed snapshot if a later capture fails.
                batch.Stats = new Dictionary<(string FeatureKey, byte Type), int>(_stats);
                _stats.Clear();
                batch.DefinitionCacheHits = Interlocked.Exchange(ref _definitionCacheHits, 0);
                batch.DefinitionCacheMisses = Interlocked.Exchange(ref _definitionCacheMisses, 0);
                batch.Enabled = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageEnabledMap);
                _uniqueUsageEnabledMap.Clear();
                batch.Disabled = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageDisabledMap);
                _uniqueUsageDisabledMap.Clear();
                batch.Used = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageUsedMap);
                _uniqueUsageUsedMap.Clear();
                batch.Viewed = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageViewedMap);
                _uniqueUsageViewedMap.Clear();
                lock (_uniqueHashLock)
                {
                    batch.UsedHashes = SnapshotHashes(_uniqueUserHashesSinceLastSend);
                    _uniqueUserHashesSinceLastSend.Clear();
                    batch.ViewedHashes = SnapshotHashes(_uniqueViewedUserHashesSinceLastSend);
                    _uniqueViewedUserHashesSinceLastSend.Clear();
                    if (_applicationUniqueUserHashesSinceLastSend.Count > 0)
                    {
                        batch.ApplicationHashes = SnapshotHashSet(_applicationUniqueUserHashesSinceLastSend);
                        _applicationUniqueUserHashesSinceLastSend.Clear();
                    }
                }
                return batch;
            }
            catch
            {
                RestoreBatch(batch);
                throw;
            }
        }

        /// <summary>
        /// Snapshot per-feature hash sets with foreach (caller must hold <see cref="_uniqueHashLock"/>).
        /// Avoids ConcurrentHashSet.ToList, which sizes from Count then CopyTo under mutation.
        /// </summary>
        private static Dictionary<string, List<int>> SnapshotHashes(ConcurrentDictionary<string, ConcurrentHashSet<int>> source)
        {
            var result = new Dictionary<string, List<int>>();
            foreach (var entry in source)
            {
                var hashes = SnapshotHashSet(entry.Value);
                if (hashes.Count > 0)
                    result[entry.Key] = hashes;
            }
            return result;
        }

        /// <summary>
        /// Copy hash set contents with foreach (caller must hold <see cref="_uniqueHashLock"/>).
        /// </summary>
        private static List<int> SnapshotHashSet(ConcurrentHashSet<int> set)
        {
            var list = new List<int>();
            foreach (var hash in set)
                list.Add(hash);
            return list;
        }

        private FeatureStat CreateDataPacket(UsageStatsBatch batch)
        {
            var dataPacket = new FeatureStat
            {
                AppKey = _appKey,
                Environment = _environment,
                Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(DateTime.UtcNow),
                TotalUniqueUsers = 0,
                AppVersion = appVersion,
                InstanceName = appInstanceName
            };
            if (processStartTime.HasValue)
                dataPacket.ProcessStartTime = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(processStartTime.Value);
            if (batch.DefinitionCacheHits > 0) dataPacket.DefinitionCacheHits = batch.DefinitionCacheHits;
            if (batch.DefinitionCacheMisses > 0) dataPacket.DefinitionCacheMisses = batch.DefinitionCacheMisses;

            var featureKeys = batch.Stats!.Keys.Select(stat => stat.FeatureKey).Distinct()
                .Union(batch.UsedHashes.Keys).Union(batch.ViewedHashes.Keys).Distinct();
            foreach (var featureKey in featureKeys)
                dataPacket.Stats.Add(CreateStatMessage(featureKey, batch));
            dataPacket.UniqueUserHashes.AddRange(batch.ApplicationHashes);
            return dataPacket;
        }

        private static StatMessage CreateStatMessage(string featureKey, UsageStatsBatch batch)
        {
            var statMessage = new StatMessage
            {
                Feature = featureKey,
                UniqueContextIdentifierEnabledCount = batch.Enabled!.TryGetValue(featureKey, out var enabled) ? enabled.Count : 0,
                UniqueContextIdentifierDisabledCount = batch.Disabled!.TryGetValue(featureKey, out var disabled) ? disabled.Count : 0,
                UniqueUsersUsedCount = batch.Used!.TryGetValue(featureKey, out var used) ? used.Count : 0
            };
            var viewedCount = GetStatCount(batch, featureKey, StatType.Viewed);
            var enabledVariant = new VariantStats
            {
                CheckCount = GetStatCount(batch, featureKey, StatType.Enabled),
                RequestCount = GetStatCount(batch, featureKey, StatType.UniqueRequestEnabled),
                UsedCount = GetStatCount(batch, featureKey, StatType.Used),
                ViewedCount = viewedCount > 0 ? viewedCount : 0
            };
            if (enabledVariant.CheckCount > 0 || enabledVariant.RequestCount > 0 || enabledVariant.UsedCount > 0 || enabledVariant.ViewedCount > 0)
                statMessage.VariantStats["enabled"] = enabledVariant;

            var disabledVariant = new VariantStats
            {
                CheckCount = GetStatCount(batch, featureKey, StatType.Disabled),
                RequestCount = GetStatCount(batch, featureKey, StatType.UniqueRequestDisabled)
            };
            if (disabledVariant.CheckCount > 0 || disabledVariant.RequestCount > 0)
                statMessage.VariantStats["disabled"] = disabledVariant;
            if (batch.UsedHashes.TryGetValue(featureKey, out var hashes)) statMessage.UniqueUserHashes.AddRange(hashes);
            if (batch.ViewedHashes.TryGetValue(featureKey, out var viewedHashes)) statMessage.UniqueViewedUserHashes.AddRange(viewedHashes);
            return statMessage;
        }

        private static int GetStatCount(UsageStatsBatch batch, string featureKey, StatType type) =>
            batch.Stats!.TryGetValue((featureKey, (byte)type), out var count) ? count : 0;

        private void RestoreBatch(UsageStatsBatch batch)
        {
            if (batch.Stats != null)
                foreach (var stat in batch.Stats)
                    _stats.AddOrUpdate(stat.Key, stat.Value, (_, oldValue) => oldValue + stat.Value);
            RestoreUsageMaps(batch);
            RestoreUserHashes(batch);
            if (batch.DefinitionCacheHits > 0) Interlocked.Add(ref _definitionCacheHits, batch.DefinitionCacheHits);
            if (batch.DefinitionCacheMisses > 0) Interlocked.Add(ref _definitionCacheMisses, batch.DefinitionCacheMisses);
        }

        private void RestoreUsageMaps(UsageStatsBatch batch)
        {
            if (batch.Enabled != null)
                foreach (var entry in batch.Enabled)
                    _uniqueUsageEnabledMap.AddOrUpdate(entry.Key, entry.Value, (_, oldValue) => new ConcurrentHashSet<int>(entry.Value.Union(oldValue)));
            if (batch.Disabled != null)
                foreach (var entry in batch.Disabled)
                    _uniqueUsageDisabledMap.AddOrUpdate(entry.Key, entry.Value, (_, oldValue) => new ConcurrentHashSet<int>(entry.Value.Union(oldValue)));
            if (batch.Used != null)
                foreach (var entry in batch.Used)
                    _uniqueUsageUsedMap.AddOrUpdate(entry.Key, entry.Value, (_, oldValue) => new ConcurrentHashSet<int>(entry.Value.Union(oldValue)));
            if (batch.Viewed != null)
                foreach (var entry in batch.Viewed)
                    _uniqueUsageViewedMap.AddOrUpdate(entry.Key, entry.Value, (_, oldValue) => new ConcurrentHashSet<int>(entry.Value.Union(oldValue)));
        }

        private void RestoreUserHashes(UsageStatsBatch batch)
        {
            lock (_uniqueHashLock)
            {
                foreach (var entry in batch.UsedHashes)
                {
                    var hashSet = _uniqueUserHashesSinceLastSend.GetOrAdd(entry.Key, _ => new ConcurrentHashSet<int>());
                    foreach (var hash in entry.Value) hashSet.Add(hash);
                }
                foreach (var entry in batch.ViewedHashes)
                {
                    var hashSet = _uniqueViewedUserHashesSinceLastSend.GetOrAdd(entry.Key, _ => new ConcurrentHashSet<int>());
                    foreach (var hash in entry.Value) hashSet.Add(hash);
                }
                foreach (var hash in batch.ApplicationHashes)
                    _applicationUniqueUserHashesSinceLastSend.Add(hash);
            }
        }

        private sealed class UsageStatsBatch
        {
            public Dictionary<(string FeatureKey, byte Type), int>? Stats { get; set; }
            public Dictionary<string, ConcurrentHashSet<int>>? Enabled { get; set; }
            public Dictionary<string, ConcurrentHashSet<int>>? Disabled { get; set; }
            public Dictionary<string, ConcurrentHashSet<int>>? Used { get; set; }
            public Dictionary<string, ConcurrentHashSet<int>>? Viewed { get; set; }
            public Dictionary<string, List<int>> UsedHashes { get; set; } = new Dictionary<string, List<int>>();
            public Dictionary<string, List<int>> ViewedHashes { get; set; } = new Dictionary<string, List<int>>();
            public List<int> ApplicationHashes { get; set; } = new List<int>();
            public int DefinitionCacheHits { get; set; }
            public int DefinitionCacheMisses { get; set; }
        }

        /// <inheritdoc/>
        public void RecordDefinitionCacheHit()
        {
            Interlocked.Increment(ref _definitionCacheHits);
        }

        /// <inheritdoc/>
        public void RecordDefinitionCacheMiss()
        {
            Interlocked.Increment(ref _definitionCacheMisses);
        }

        /// <inheritdoc/>
        public async Task RecordUsageAsync(string featureKey)
        {
            TryLog(LogLevel.Trace, "Record feature usage: {featureKey}", featureKey);

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
            TryLog(LogLevel.Trace, "Record feature usage: {featureKey}", featureKey);

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
        public async Task RecordViewAsync(string featureKey)
        {
            TryLog(LogLevel.Trace, "Record feature view: {featureKey}", featureKey);

            // Use AddOrUpdate with lambda for atomic increment - prevents race condition with SendStats
            _stats.AddOrUpdate(
                (featureKey, (byte)StatType.Viewed),
                1, // Add: if key doesn't exist, set to 1
                (key, existingValue) => existingValue + 1); // Update: if key exists, increment

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync().ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageViewedMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>());
                    currentUniqueValue.Add(GetDeterministicHashCode(uniqueIdentifier));
                    
                    // Track user ID for monthly unique user tracking (incremental) - use "viewed" hash list
                    RecordUniqueViewedUserId(featureKey, uniqueIdentifier);
                    
                    // Track user ID at application level for monthly unique user tracking (incremental)
                    RecordApplicationUniqueUserId(uniqueIdentifier);
                }
            }
        }

        /// <inheritdoc/>
        public async Task RecordViewAsync<TContext>(string featureKey, TContext context)
        {
            TryLog(LogLevel.Trace, "Record feature view: {featureKey}", featureKey);

            // Use AddOrUpdate with lambda for atomic increment - prevents race condition with SendStats
            _stats.AddOrUpdate(
                (featureKey, (byte)StatType.Viewed),
                1, // Add: if key doesn't exist, set to 1
                (key, existingValue) => existingValue + 1); // Update: if key exists, increment

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context).ConfigureAwait(false);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageViewedMap.GetOrAdd(featureKey, new ConcurrentHashSet<int>());
                    currentUniqueValue.Add(GetDeterministicHashCode(uniqueIdentifier));
                    
                    // Track user ID for monthly unique user tracking (incremental) - use "viewed" hash list
                    RecordUniqueViewedUserId(featureKey, uniqueIdentifier);
                    
                    // Track user ID at application level for monthly unique user tracking (incremental)
                    RecordApplicationUniqueUserId(uniqueIdentifier);
                }
            }
        }

        /// <inheritdoc/>
        public async Task RecordCheckAsync(string featureKey, bool allowed)
        {
            TryLog(LogLevel.Trace, "Record feature check: {featureKey}", featureKey);

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
            TryLog(LogLevel.Trace, "Record feature check: {featureKey}", featureKey);

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

            lock (_uniqueHashLock)
            {
                var hashSet = _uniqueUserHashesSinceLastSend.GetOrAdd(featureKey, _ => new ConcurrentHashSet<int>());

                // Check size limit to prevent unbounded growth
                if (hashSet.Count >= MaxUniqueUserHashesPerFeature)
                {
                    TryLog(LogLevel.Warning, "Unique user hash limit reached for feature {FeatureKey}. Consider sending more frequently or increasing limit.", featureKey);
                    // Still try to add, but log warning
                }

                hashSet.Add(hash);
            }
        }
        
        /// <summary>
        /// Record a unique user ID hash for a feature when the feature is checked/viewed (but not necessarily used).
        /// Used for monthly unique user tracking. The user ID is based on uniqueContextIdentifier from IFeatureContextProvider.
        /// The user ID is hashed and tracked incrementally (since last send) and sent to Toggly for server-side deduplication.
        /// Uses hashes instead of full user IDs to reduce memory and network usage (~80% reduction).
        /// </summary>
        /// <param name="featureKey">The feature key to track unique viewed users for</param>
        /// <param name="userId">The unique user identifier from uniqueContextIdentifier (e.g., email, username, user ID)</param>
        private void RecordUniqueViewedUserId(string featureKey, string userId)
        {
            if (string.IsNullOrWhiteSpace(featureKey) || string.IsNullOrWhiteSpace(userId))
                return;

            var hash = GetDeterministicHashCode(userId);

            lock (_uniqueHashLock)
            {
                var hashSet = _uniqueViewedUserHashesSinceLastSend.GetOrAdd(featureKey, _ => new ConcurrentHashSet<int>());

                // Check size limit to prevent unbounded growth
                if (hashSet.Count >= MaxUniqueUserHashesPerFeature)
                {
                    TryLog(LogLevel.Warning, "Unique viewed user hash limit reached for feature {FeatureKey}. Consider sending more frequently or increasing limit.", featureKey);
                    // Still try to add, but log warning
                }

                hashSet.Add(hash);
            }
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

            lock (_uniqueHashLock)
            {
                // Check size limit to prevent unbounded growth
                if (_applicationUniqueUserHashesSinceLastSend.Count >= MaxApplicationUniqueUserHashes)
                {
                    TryLog(LogLevel.Warning, "Application-level unique user hash limit reached. Consider sending more frequently or increasing limit.");
                    // Still try to add, but log warning
                }

                _applicationUniqueUserHashesSinceLastSend.Add(hash);
            }
        }

        /// <inheritdoc/>
        public UsageStatsDebugInfo GetDebugInfo()
        {
            return new UsageStatsDebugInfo
            {
                AppKey = AppKeySanitizer.Sanitize(_appKey),
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
            if (_disposed) return;
            _disposed = true;
            _shuttingDown = true;

            // Stop the timers
            _timer?.Change(Timeout.Infinite, Timeout.Infinite);
            _longTimer?.Change(Timeout.Infinite, Timeout.Infinite);

            _timer?.Dispose();
            _longTimer?.Dispose();
            _sendStatsSemaphore?.Dispose();

            GC.SuppressFinalize(this);
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
