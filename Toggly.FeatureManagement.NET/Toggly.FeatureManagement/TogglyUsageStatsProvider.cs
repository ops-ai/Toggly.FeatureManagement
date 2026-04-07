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

        private volatile bool _disposed = false;
        private volatile bool _shuttingDown = false;

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
            applicationLifetime.ApplicationStopping.Register(OnApplicationStopping);

            var version = $"{Assembly.GetAssembly(typeof(TogglyFeatureProvider))?.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version}";
            userAgent = $"Toggly.FeatureManagement/{version}";
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
            // Prevent concurrent send operations (timer, longTimer, and ApplicationStopping could overlap)
            if (!await _sendStatsSemaphore.WaitAsync(0).ConfigureAwait(false))
            {
                if (!suppressLogging) TryLog(LogLevel.Debug, "SendStats already in progress, skipping");
                return;
            }

            // Declare variables outside try block so they're accessible in catch
            Dictionary<(string FeatureKey, byte Type), int>? stats = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageEnabledMap = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageDisabledMap = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageUsedMap = null;
            Dictionary<string, ConcurrentHashSet<int>>? uniqueUsageViewedMap = null;
            Dictionary<string, List<int>>? uniqueUserHashesToSend = null;
            Dictionary<string, List<int>>? uniqueViewedUserHashesToSend = null;
            List<int>? applicationUniqueUserHashesToSend = null;

            try
            {
                if (_stats.IsEmpty && _uniqueUserHashesSinceLastSend.IsEmpty && _uniqueViewedUserHashesSinceLastSend.IsEmpty && _applicationUniqueUserHashesSinceLastSend.IsEmpty)
                {
                    if (!suppressLogging) TryLog(LogLevel.Trace, "Send stats - nothing to send");
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
                uniqueUsageViewedMap = new Dictionary<string, ConcurrentHashSet<int>>(_uniqueUsageViewedMap);
                _uniqueUsageViewedMap.Clear();
                
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
                
                // Clone unique viewed user hashes for monthly tracking (incremental since last send)
                uniqueViewedUserHashesToSend = new Dictionary<string, List<int>>();
                foreach (var kvp in _uniqueViewedUserHashesSinceLastSend)
                {
                    if (kvp.Value.Count > 0)
                    {
                        uniqueViewedUserHashesToSend[kvp.Key] = kvp.Value.ToList();
                    }
                }
                _uniqueViewedUserHashesSinceLastSend.Clear();
                
                // Clone application-level unique user hashes for monthly tracking (incremental since last send)
                if (_applicationUniqueUserHashesSinceLastSend.Count > 0)
                {
                    applicationUniqueUserHashesToSend = _applicationUniqueUserHashesSinceLastSend.ToList();
                    _applicationUniqueUserHashesSinceLastSend.Clear();
                }

                if (!suppressLogging) TryLog(LogLevel.Trace, "Sending stats");
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

                // Get all feature keys (from stats, unique user hashes, and unique viewed user hashes)
                var featureKeysFromStats = stats.Keys.Select(t => t.FeatureKey).Distinct().ToList();
                var featureKeysFromUsedHashes = uniqueUserHashesToSend.Keys.ToList();
                var featureKeysFromViewedHashes = uniqueViewedUserHashesToSend.Keys.ToList();
                var allFeatureKeys = featureKeysFromStats.Union(featureKeysFromUsedHashes).Union(featureKeysFromViewedHashes).Distinct().ToList();
                
                for (int i = 0; i < allFeatureKeys.Count; i++)
                {
                    var featureKey = allFeatureKeys[i];
                    var enabledCheckCount = stats.TryGetValue((featureKey, (byte)StatType.Enabled), out var enabledCount) ? enabledCount : 0;
                    var disabledCheckCount = stats.TryGetValue((featureKey, (byte)StatType.Disabled), out var disabledCount) ? disabledCount : 0;
                    var uniqueRequestEnabledCount = stats.TryGetValue((featureKey, (byte)StatType.UniqueRequestEnabled), out var uniqueEnabledCount) ? uniqueEnabledCount : 0;
                    var uniqueRequestDisabledCount = stats.TryGetValue((featureKey, (byte)StatType.UniqueRequestDisabled), out var uniqueDisabledCount) ? uniqueDisabledCount : 0;
                    var usedCountTotal = stats.TryGetValue((featureKey, (byte)StatType.Used), out var usedCount) ? usedCount : 0;

                    var statMessage = new StatMessage
                    {
                        Feature = featureKey,
                        UniqueContextIdentifierEnabledCount = uniqueUsageEnabledMap.TryGetValue(featureKey, out var uniqueIdEnabledCount) ? uniqueIdEnabledCount.Count : 0,
                        UniqueContextIdentifierDisabledCount = uniqueUsageDisabledMap.TryGetValue(featureKey, out var uniqueIdDisabledCount) ? uniqueIdDisabledCount.Count : 0,
                        UniqueUsersUsedCount = uniqueUsageUsedMap.TryGetValue(featureKey, out var uniqueUsedCount) ? uniqueUsedCount.Count : 0
                    };

                    // Legacy scalar counts map to variantStats (enabled / disabled); server reads these instead of deprecated fields.
                    if (enabledCheckCount > 0 || uniqueRequestEnabledCount > 0 || usedCountTotal > 0)
                    {
                        statMessage.VariantStats["enabled"] = new VariantStats
                        {
                            CheckCount = enabledCheckCount,
                            RequestCount = uniqueRequestEnabledCount,
                            UsedCount = usedCountTotal
                        };
                    }

                    if (disabledCheckCount > 0 || uniqueRequestDisabledCount > 0)
                    {
                        statMessage.VariantStats["disabled"] = new VariantStats
                        {
                            CheckCount = disabledCheckCount,
                            RequestCount = uniqueRequestDisabledCount
                        };
                    }

                    // Add viewedCount via variantStats (new approach, not legacy fields)
                    var viewedCount = stats.TryGetValue((featureKey, (byte)StatType.Viewed), out var vc) ? vc : 0;
                    if (viewedCount > 0)
                    {
                        // Views are associated with "enabled" variant by default (you only view enabled features)
                        if (!statMessage.VariantStats.ContainsKey("enabled"))
                        {
                            statMessage.VariantStats["enabled"] = new VariantStats();
                        }
                        statMessage.VariantStats["enabled"].ViewedCount = viewedCount;
                    }
                    
                    // Add unique user hashes for monthly tracking (incremental since last send)
                    if (uniqueUserHashesToSend != null && uniqueUserHashesToSend.TryGetValue(featureKey, out var hashes))
                    {
                        statMessage.UniqueUserHashes.AddRange(hashes);
                    }
                    
                    // Add unique viewed user hashes for monthly tracking (incremental since last send)
                    if (uniqueViewedUserHashesToSend != null && uniqueViewedUserHashesToSend.TryGetValue(featureKey, out var viewedHashes))
                    {
                        statMessage.UniqueViewedUserHashes.AddRange(viewedHashes);
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
                    if (!suppressLogging) TryLog(LogLevel.Warning, "Feature count did not match. Possible data integrity issues");

                _lastSend = DateTime.UtcNow;
            }
            catch (Exception ex)
            {
                if (!suppressLogging) TryLog(LogLevel.Error, ex, "Error sending stats to toggly");

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

                if (uniqueUsageViewedMap != null)
                {
                    foreach (var u in uniqueUsageViewedMap)
                        _uniqueUsageViewedMap.AddOrUpdate(u.Key, u.Value, (_, oldValue) => new ConcurrentHashSet<int>(u.Value.Union(oldValue)));
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
                
                // Restore unique viewed user hashes on error
                if (uniqueViewedUserHashesToSend != null)
                {
                    foreach (var kvp in uniqueViewedUserHashesToSend)
                    {
                        var hashSet = _uniqueViewedUserHashesSinceLastSend.GetOrAdd(kvp.Key, _ => new ConcurrentHashSet<int>());
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
            var hashSet = _uniqueUserHashesSinceLastSend.GetOrAdd(featureKey, _ => new ConcurrentHashSet<int>());
            
            // Check size limit to prevent unbounded growth
            if (hashSet.Count >= MaxUniqueUserHashesPerFeature)
            {
                TryLog(LogLevel.Warning, "Unique user hash limit reached for feature {FeatureKey}. Consider sending more frequently or increasing limit.", featureKey);
                // Still try to add, but log warning
            }
            
            hashSet.Add(hash);
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
            var hashSet = _uniqueViewedUserHashesSinceLastSend.GetOrAdd(featureKey, _ => new ConcurrentHashSet<int>());
            
            // Check size limit to prevent unbounded growth
            if (hashSet.Count >= MaxUniqueUserHashesPerFeature)
            {
                TryLog(LogLevel.Warning, "Unique viewed user hash limit reached for feature {FeatureKey}. Consider sending more frequently or increasing limit.", featureKey);
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
                TryLog(LogLevel.Warning, "Application-level unique user hash limit reached. Consider sending more frequently or increasing limit.");
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
