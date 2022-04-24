﻿using Grpc.Net.Client;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
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

        /// <summary>
        /// keyed by feature name
        /// values are list of unique users with status: d-email vs e-email
        /// </summary>
        private readonly ConcurrentDictionary<string, HashSet<string>> _uniqueUsageMap = new ConcurrentDictionary<string, HashSet<string>>();

        public TogglyUsageStatsProvider(IOptions<TogglySettings> togglySettings, ILoggerFactory loggerFactory, IHttpClientFactory clientFactory, IHostApplicationLifetime applicationLifetime, IServiceProvider serviceProvider)
        {
            _appKey = togglySettings.Value.AppKey;
            _environment = togglySettings.Value.Environment;
            _baseUrl = togglySettings.Value.BaseUrl;
            _clientFactory = clientFactory;
            _contextProvider = (IFeatureContextProvider?)serviceProvider.GetService(typeof(IFeatureContextProvider));

            _logger = loggerFactory.CreateLogger<TogglyUsageStatsProvider>();

            _timer = new Timer((s) => SendStats().ConfigureAwait(false), null, new TimeSpan(0, 5, 0), new TimeSpan(0, 5, 0));
            _longTimer = new Timer((s) => ResetUsageMap().ConfigureAwait(false), null, new TimeSpan(1, 0, 0, 0), new TimeSpan(1, 0, 0, 0));
            applicationLifetime.ApplicationStopping.Register(() => SendStats().ConfigureAwait(false).GetAwaiter().GetResult());
        }

        private async Task ResetUsageMap()
        {
            if (!_uniqueUsageMap.Any())
                return;

            await SendStats().ConfigureAwait(false);
            _uniqueUsageMap.Clear();
        }

        private async Task SendStats()
        {
            try
            {
                if (_stats.IsEmpty)
                    return;

                var currentTime = DateTime.UtcNow;

                using var httpClient = _clientFactory.CreateClient("toggly");
                using var channel = GrpcChannel.ForAddress(_baseUrl, new GrpcChannelOptions { HttpClient = httpClient });
                var client = new Usage.UsageClient(channel);
                var dataPacket = new FeatureStat
                {
                    AppKey = _appKey,
                    Environment = _environment,
                    Time = Google.Protobuf.WellKnownTypes.Timestamp.FromDateTime(currentTime),
                };

                foreach (var stat in _stats.GroupBy(t => t.Key[1..]))
                {
                    dataPacket.Stats.Add(new StatMessage
                    {
                        EnabledCount = stat.Any(s => s.Key.StartsWith('a')) ? stat.First(s => s.Key.StartsWith('a')).Value : 0,
                        DisabledCount = stat.Any(s => s.Key.StartsWith('d')) ? stat.First(s => s.Key.StartsWith('d')).Value : 0,
                        Feature = stat.Key,
                        UniqueContextIdentifierDisabledCount = _uniqueUsageMap.ContainsKey(stat.Key) ? _uniqueUsageMap[stat.Key].Count(s => s.StartsWith("e")) : 0,
                        UniqueContextIdentifierEnabledCount = _uniqueUsageMap.ContainsKey(stat.Key) ? _uniqueUsageMap[stat.Key].Count(s => s.StartsWith("d")) : 0,
                        UniqueRequestDisabledCount = stat.Any(s => s.Key.StartsWith('u')) ? stat.First(s => s.Key.StartsWith('u')).Value : 0,
                        UniqueRequestEnabledCount = stat.Any(s => s.Key.StartsWith('x')) ? stat.First(s => s.Key.StartsWith('x')).Value : 0,
                        ValueDeliveredCount = stat.Any(s => s.Key.StartsWith('v')) ? stat.First(s => s.Key.StartsWith('v')).Value : 0,
                        UniqueUsersValueDeliveredCount = _uniqueUsageMap.ContainsKey(stat.Key) ? _uniqueUsageMap[stat.Key].Count(s => s.StartsWith("v")) : 0
                    });
                }

                _stats.Clear();

                var result = await client.SendStatsAsync(dataPacket).ConfigureAwait(false);

                if (result.FeatureCount != dataPacket.Stats.Count)
                    _logger.LogWarning("Feature count did not match. Possible data integrity issues");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending stats to toggly");
            }
        }

        public async Task RecordValueDeliveredAsync(string feature)
        {
            int currentValue;
            do {
                currentValue = _stats.GetOrAdd($"v-{feature}", 0);
            } while (!_stats.TryUpdate($"v-{feature}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync();
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(feature, new HashSet<string>());
                    currentUniqueValue.Add($"v{uniqueIdentifier}");
                }
            }
        }

        public async Task RecordUsageAsync(string feature, bool allowed)
        {
            //record stats keyed by feature status
            int currentValue;
            do {
                currentValue = _stats.GetOrAdd(allowed ? $"a{feature}" : $"d{feature}", 0);
            } while (!_stats.TryUpdate(allowed ? $"a{feature}" : $"d{feature}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(feature);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? $"c{feature}" : $"b{feature}", 0);
                    } while (!_stats.TryUpdate(allowed ? $"c{feature}" : $"b{feature}", currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync();
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(feature, new HashSet<string>());
                    currentUniqueValue.Add(allowed ? $"a{uniqueIdentifier}" : $"d{uniqueIdentifier}");
                }
            }
        }

        public async Task RecordUsageAsync<TContext>(string feature, TContext context, bool allowed)
        {
            //record stats keyed by feature status

            int currentValue;
            do
            {
                currentValue = _stats.GetOrAdd(allowed ? $"a{feature}" : $"d{feature}", 0);
            } while (!_stats.TryUpdate(allowed ? $"a{feature}" : $"d{feature}", currentValue + 1, currentValue));

            if (_contextProvider != null)
            {
                var usedInRequest = await _contextProvider.AccessedInRequestAsync(feature, context);
                if (!usedInRequest)
                {
                    int currentRequestValue;
                    do
                    {
                        currentRequestValue = _stats.GetOrAdd(allowed ? $"c{feature}" : $"b{feature}", 0);
                    } while (!_stats.TryUpdate(allowed ? $"c{feature}" : $"b{feature}", currentRequestValue + 1, currentRequestValue));
                }

                var uniqueIdentifier = await _contextProvider.GetContextIdentifierAsync(context);
                if (uniqueIdentifier != null)
                {
                    var currentUniqueValue = _uniqueUsageMap.GetOrAdd(feature, new HashSet<string>());
                    currentUniqueValue.Add(allowed ? $"a{uniqueIdentifier}" : $"d{uniqueIdentifier}");
                }
            }
        }
    }
}
