using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Serializes catalog writes for one cache key within this process.
    /// </summary>
    public sealed class CatalogWriterGate
    {
        private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates = new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);

        /// <summary>
        /// Enters the process-local writer gate for a catalog cache key.
        /// </summary>
        public async Task<IDisposable> EnterAsync(string cacheKey, CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(cacheKey)) throw new ArgumentException("Cache key is required.", nameof(cacheKey));

            var gate = Gates.GetOrAdd(cacheKey, _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            return new Releaser(gate);
        }

        private sealed class Releaser : IDisposable
        {
            private SemaphoreSlim? _gate;

            public Releaser(SemaphoreSlim gate)
            {
                _gate = gate;
            }

            public void Dispose()
            {
                var gate = Interlocked.Exchange(ref _gate, null);
                if (gate != null) gate.Release();
            }
        }
    }
}
