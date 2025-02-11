using ConcurrentCollections;
using Microsoft.FeatureManagement;
using System;
using System.Collections.Concurrent;

namespace Toggly.FeatureManagement
{
    /// <summary>
    /// Debug information for the feature provider
    /// </summary>
    public class FeatureProviderDebugInfo
    {

        /// <summary>
        /// Running App key
        /// </summary>
        public string? AppKey { get; set; }

        /// <summary>
        /// Running Environment
        /// </summary>
        public string? Environment { get; set; }

        /// <summary>
        /// Feature definitions
        /// </summary>
        public ConcurrentDictionary<string, FeatureDefinition>? Definitions { get; set; }

        /// <summary>
        /// Experiments
        /// </summary>
        public ConcurrentDictionary<string, ConcurrentHashSet<string>>? Experiments { get; set; }

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
        /// Last refresh time
        /// </summary>
        public DateTime? LastRefresh { get; set; }
        
        /// <summary>
        /// Websocket client running
        /// </summary>
        public bool WebsocketClientRunning { get; set; }

        /// <summary>
        /// Loaded
        /// </summary>
        public bool Loaded { get; set; }
    }
}