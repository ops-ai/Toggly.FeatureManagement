using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Toggly.FeatureManagement.Catalog;

namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Authoritative embedded catalog store backed by one distributed-cache entry per catalog.
    /// </summary>
    public sealed class DistributedCacheCatalogStore : ITogglyCatalogStore
    {
        private static readonly JsonSerializerOptions EnvelopeSerializerOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = false,
            PropertyNamingPolicy = null,
            WriteIndented = false
        };

        private readonly IDistributedCache _cache;
        private readonly TogglyDistributedCacheCatalogOptions _options;
        private readonly CatalogWriterGate _writerGate;

        /// <summary>
        /// Initializes the store using the host's distributed cache and configured access mode.
        /// </summary>
        public DistributedCacheCatalogStore(
            IDistributedCache cache,
            IOptions<TogglyDistributedCacheCatalogOptions> options,
            CatalogWriterGate writerGate)
        {
            _cache = cache ?? throw new ArgumentNullException(nameof(cache));
            if (options == null) throw new ArgumentNullException(nameof(options));
            _options = options.Value ?? throw new ArgumentException("Catalog options are required.", nameof(options));
            _writerGate = writerGate ?? throw new ArgumentNullException(nameof(writerGate));
        }

        /// <inheritdoc />
        public CatalogStoreCapabilities Capabilities { get; } = new CatalogStoreCapabilities { SupportsMultipleWriters = false };

        /// <inheritdoc />
        public async Task<CatalogSnapshot?> ReadAsync(string catalogName, CancellationToken cancellationToken = default(CancellationToken))
        {
            var normalizedName = ValidateCatalogName(catalogName);
            var bytes = await _cache.GetAsync(GetCatalogKey(normalizedName), cancellationToken).ConfigureAwait(false);
            if (bytes == null) return null;

            return DeserializeSnapshot(bytes, normalizedName);
        }

        /// <inheritdoc />
        public async Task<CatalogWriteResult> TryWriteAsync(
            string catalogName,
            CatalogDocument document,
            string? expectedRevision,
            CancellationToken cancellationToken = default(CancellationToken))
        {
            var normalizedName = ValidateCatalogName(catalogName);
            if (document == null) throw new ArgumentNullException(nameof(document));
            if (_options.AccessMode != CatalogCacheAccessMode.SingleWriter)
            {
                throw new InvalidOperationException("Distributed-cache catalog Reader mode does not permit writes. Configure AccessMode as SingleWriter for exactly one writer process per catalog.");
            }

            var payload = CatalogJson.Serialize(document);
            var normalizedDocument = CatalogJson.Parse(payload);
            var cacheKey = GetCatalogKey(normalizedName);
            using (await _writerGate.EnterAsync(cacheKey, cancellationToken).ConfigureAwait(false))
            {
                var currentBytes = await _cache.GetAsync(cacheKey, cancellationToken).ConfigureAwait(false);
                var current = currentBytes == null ? null : DeserializeSnapshot(currentBytes, normalizedName);

                if (current == null)
                {
                    if (expectedRevision != null) return CatalogWriteResult.Conflict();
                }
                else if (expectedRevision == null || !string.Equals(expectedRevision, current.Revision, StringComparison.Ordinal))
                {
                    return CatalogWriteResult.Conflict(current);
                }

                var committed = new CatalogSnapshot
                {
                    CatalogName = normalizedName,
                    Revision = Guid.NewGuid().ToString("D"),
                    UpdatedAtUtc = DateTimeOffset.UtcNow,
                    Document = normalizedDocument
                };
                var envelope = new CatalogStorageEnvelope
                {
                    CatalogName = committed.CatalogName,
                    Revision = committed.Revision,
                    UpdatedAtUtc = committed.UpdatedAtUtc,
                    Payload = payload
                };

                var bytes = JsonSerializer.SerializeToUtf8Bytes(envelope, EnvelopeSerializerOptions);
                await _cache.SetAsync(cacheKey, bytes, new DistributedCacheEntryOptions(), cancellationToken).ConfigureAwait(false);
                return CatalogWriteResult.Written(CloneSnapshot(committed));
            }
        }

        /// <summary>
        /// Returns the isolated distributed-cache key for a logical catalog name.
        /// </summary>
        public static string GetCatalogKey(string catalogName)
        {
            var normalizedName = ValidateCatalogName(catalogName);
            using (var hash = SHA256.Create())
            {
                var bytes = hash.ComputeHash(Encoding.UTF8.GetBytes(normalizedName));
                var builder = new StringBuilder(bytes.Length * 2);
                foreach (var value in bytes)
                {
                    builder.Append(value.ToString("x2", System.Globalization.CultureInfo.InvariantCulture));
                }

                return "Toggly:Catalogs:" + builder;
            }
        }

        private static CatalogSnapshot DeserializeSnapshot(byte[] bytes, string expectedCatalogName)
        {
            CatalogStorageEnvelope? envelope;
            try
            {
                envelope = JsonSerializer.Deserialize<CatalogStorageEnvelope>(bytes, EnvelopeSerializerOptions);
            }
            catch (JsonException exception)
            {
                throw new InvalidOperationException("Distributed-cache catalog payload is invalid.", exception);
            }

            if (envelope == null || string.IsNullOrWhiteSpace(envelope.CatalogName) || string.IsNullOrWhiteSpace(envelope.Revision) || envelope.UpdatedAtUtc == default(DateTimeOffset) || envelope.Payload == null)
            {
                throw new InvalidOperationException("Distributed-cache catalog payload is incomplete.");
            }

            if (!string.Equals(envelope.CatalogName, expectedCatalogName, StringComparison.Ordinal))
            {
                throw new InvalidOperationException("Catalog identity collision detected.");
            }

            return new CatalogSnapshot
            {
                CatalogName = envelope.CatalogName,
                Revision = envelope.Revision,
                UpdatedAtUtc = envelope.UpdatedAtUtc,
                Document = CatalogJson.Parse(envelope.Payload)
            };
        }

        private static CatalogSnapshot CloneSnapshot(CatalogSnapshot source)
        {
            return new CatalogSnapshot
            {
                CatalogName = source.CatalogName,
                Revision = source.Revision,
                UpdatedAtUtc = source.UpdatedAtUtc,
                Document = CatalogJson.Parse(CatalogJson.Serialize(source.Document))
            };
        }

        private static string ValidateCatalogName(string catalogName)
        {
            if (string.IsNullOrWhiteSpace(catalogName)) throw new ArgumentException("Catalog name is required.", nameof(catalogName));
            return catalogName;
        }

        private sealed class CatalogStorageEnvelope
        {
            [JsonPropertyName("catalogName")]
            public string CatalogName { get; set; } = string.Empty;

            [JsonPropertyName("revision")]
            public string Revision { get; set; } = string.Empty;

            [JsonPropertyName("updatedAtUtc")]
            public DateTimeOffset UpdatedAtUtc { get; set; }

            [JsonPropertyName("payload")]
            public string? Payload { get; set; }
        }
    }
}
