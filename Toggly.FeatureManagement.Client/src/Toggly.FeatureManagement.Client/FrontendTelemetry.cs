using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace Toggly.FeatureManagement.Client;

/// <summary>Optional telemetry companion; existing feature-session implementations need not implement it.</summary>
public interface IFrontendTelemetry
{
    void RecordUsage(string featureKey, string variant = "enabled");
    void RecordView(string featureKey, string variant = "enabled");
    void IncrementCounter(string metricKey, double value = 1);
    void SetGauge(string metricKey, double value);
    Task FlushTelemetryAsync(CancellationToken cancellationToken = default);
}

/// <summary>Explicit HTTP result. Exceptions represent ambiguous delivery and are never replayed.</summary>
public sealed record FrontendTelemetryResponse(int StatusCode, string? RetryAfter = null);

/// <summary>Host transport boundary; implementations must omit credentials and automatic retries.</summary>
/// <remarks>The host retains ownership of supplied transports. Payload contains only public aggregate telemetry.</remarks>
public interface IFrontendTelemetryTransport
{
    Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken cancellationToken);
}

internal sealed class NativeTelemetryTransport : IFrontendTelemetryTransport, IDisposable
{
    // This dedicated client never inherits definitions headers, cookies or authentication.
    private readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, Credentials = null })
    {
        Timeout = TimeSpan.FromSeconds(5)
    };

    public async Task<FrontendTelemetryResponse> SendAsync(Uri endpoint, ReadOnlyMemory<byte> payload, bool gzip, bool keepalive, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        request.Content = new ByteArrayContent(payload.ToArray());
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        if (gzip)
            request.Content.Headers.ContentEncoding.Add("gzip");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        return new((int)response.StatusCode, response.Headers.TryGetValues("Retry-After", out var values) ? values.FirstOrDefault() : null);
    }
    public void Dispose() => http.Dispose();
}

/// <summary>Bounded memory-only aggregate owner. No lifetime name or encoded-key cache.</summary>
internal sealed class FrontendTelemetryReporter : IFrontendTelemetry, IAsyncDisposable
{
    private const int EntryLimit = 2000, EnvelopeLimit = 49152, BufferLimit = 262144, ValueLimit = 1000000;
    private sealed record Feature(long Checks = 0, long Used = 0, long Viewed = 0)
    {
        public int Pieces => (int)((Math.Max(Checks, Math.Max(Used, Viewed)) - 1) / ValueLimit + 1);
        public Feature First => new(Math.Min(Checks, ValueLimit), Math.Min(Used, ValueLimit), Math.Min(Viewed, ValueLimit));
        public long[] Values => Viewed > 0 ? [Checks, Used, Viewed] : Used > 0 ? [Checks, Used] : [Checks];
    }
    private sealed record Metric(double Value, bool Counter)
    {
        public int Pieces => Counter ? Math.Max(1, (int)Math.Ceiling(Value / ValueLimit)) : 1;
        public double First => Counter ? Math.Min(Value, ValueLimit) : Value;
    }
    private sealed record Stored<T>(T Value, int Entries, long UpperBytes);
    private sealed record Batch(byte[] Bytes, int Entries, long CreatedAt);
    private readonly object sync = new();
    private readonly TogglyClientOptions options;
    private readonly Uri? endpoint;
    private readonly Func<long> now;
    private readonly Func<int, CancellationToken, Task> delay;
    private readonly Func<byte[], byte[]> compress;
    private readonly TimeSpan timeout;
    private readonly CancellationTokenSource lifetime = new();
    private readonly Dictionary<(string Key, string Variant), Stored<Feature>> features = [];
    private readonly Dictionary<string, Stored<Metric>> metrics = new(StringComparer.Ordinal);
    private readonly Queue<Batch> queue = new();
    private Dictionary<string, bool> queuedKinds = new(StringComparer.Ordinal);
    private long pendingBytes, queuedBytes;
    private int pendingEntries, queuedEntries;
    private bool disposed, finalAttempted, closed;
    private Task? flight, periodic, disposal;
    private CancellationTokenSource? retry, activeRequest;
    private readonly int interval;
    private IFrontendTelemetryTransport? transport;
    private NativeTelemetryTransport? ownedTransport;
    private bool Enabled => options.EnableTelemetry && !string.IsNullOrWhiteSpace(options.AppKey) && endpoint is not null;

    internal FrontendTelemetryReporter(TogglyClientOptions options, Func<long>? now = null,
        Func<int, CancellationToken, Task>? delay = null, Func<byte[], byte[]>? compress = null, TimeSpan? timeout = null)
    {
        this.options = options;
        endpoint = Endpoint(options.MetricsBaseUrl);
        this.now = now ?? (() => (long)(Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency));
        this.delay = delay ?? ((ms, ct) => Task.Delay(ms, ct));
        this.compress = compress ?? Gzip;
        this.timeout = timeout ?? TimeSpan.FromSeconds(5);
        interval = options.TelemetryFlushIntervalMs is >= 30000 and <= 60000 ? options.TelemetryFlushIntervalMs : 45000;
        transport = options.TelemetryTransport;
        if (options.EnableTelemetry && !string.IsNullOrWhiteSpace(options.AppKey))
        {
            if (endpoint is null || interval != options.TelemetryFlushIntervalMs)
                Diagnose("invalid-option");
        }
    }

    internal static Uri? Endpoint(string? value)
    {
        if (value is null || value.Contains('?') || value.Contains('#') || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || string.IsNullOrEmpty(uri.Host) || uri.UserInfo.Length > 0)
            return null;
        var delimiter = value.IndexOf("://", StringComparison.Ordinal);
        if (delimiter < 0)
            return null;
        var authority = value[(delimiter + 3)..].Split('/', '\\')[0];
        if (string.IsNullOrWhiteSpace(authority) || authority.Contains('@'))
            return null;
        return new UriBuilder(uri) { Path = uri.AbsolutePath.TrimEnd('/') + "/api/frontend/telemetry" }.Uri;
    }

    internal void RecordCheck(string key, string variant) => RecordFeature(key, variant, 0);
    public void RecordUsage(string featureKey, string variant = "enabled") => RecordFeature(featureKey, variant, 1);
    public void RecordView(string featureKey, string variant = "enabled") => RecordFeature(featureKey, variant, 2);
    private void RecordFeature(string key, string variant, int index)
    {
        lock (sync)
        {
            if (!Enabled || disposed)
                return;
            if (string.IsNullOrWhiteSpace(key) || variant is null || variant.Length is < 1 or > 64 || variant.Any(c => !(c is >= 'a' and <= 'z' or >= 'A' and <= 'Z' or >= '0' and <= '9' or '_' or '-')))
            {
                Diagnose("invalid-event");
                return;
            }
            var name = (key, variant);
            features.TryGetValue(name, out var old);
            var before = old?.Value ?? new Feature();
            var value = index switch
            {
                0 => before with { Checks = before.Checks + 1 },
                1 => before with { Used = before.Used + 1 },
                _ => before with { Viewed = before.Viewed + 1 }
            };
            var size = Encode(new()
            {
                [key] = new()
                {
                    [variant] = value.First.Values
                }
            }, []).Length;
            if (size > EnvelopeLimit)
            {
                Diagnose("oversized-entry");
                return;
            }
            var next = new Stored<Feature>(value, value.Pieces, (long)size * value.Pieces);
            features[name] = next;
            Admit(old?.Entries ?? 0, old?.UpperBytes ?? 0, next.Entries, next.UpperBytes, () => { if (old is null) features.Remove(name); else features[name] = old; });
        }
    }
    public void IncrementCounter(string metricKey, double value = 1) => RecordMetric(metricKey, value, true);
    public void SetGauge(string metricKey, double value) => RecordMetric(metricKey, value, false);
    private void RecordMetric(string key, double amount, bool counter)
    {
        lock (sync)
        {
            if (!Enabled || disposed)
                return;
            if (string.IsNullOrWhiteSpace(key) || !double.IsFinite(amount) || amount < 0 || amount > ValueLimit || (counter && amount % 1 != 0))
            {
                Diagnose("invalid-event");
                return;
            }
            metrics.TryGetValue(key, out var old);
            if ((old is not null && old.Value.Counter != counter) || (queuedKinds.TryGetValue(key, out var kind) && kind != counter))
            {
                Diagnose("metric-kind-conflict");
                return;
            }
            var value = new Metric(counter ? (old?.Value.Value ?? 0) + amount : amount, counter);
            if (value.Value > (double)ValueLimit * EntryLimit)
            {
                Diagnose("buffer-limit");
                return;
            }
            var size = Encode([], new()
            {
                [key] = value.First
            }).Length;
            if (size > EnvelopeLimit)
            {
                Diagnose("oversized-entry");
                return;
            }
            var next = new Stored<Metric>(value, value.Pieces, (long)size * value.Pieces);
            metrics[key] = next;
            Admit(old?.Entries ?? 0, old?.UpperBytes ?? 0, next.Entries, next.UpperBytes, () => { if (old is null) metrics.Remove(key); else metrics[key] = old; });
        }
    }
    private void Admit(int oldEntries, long oldBytes, int entries, long bytes, Action undo)
    {
        var totalEntries = pendingEntries - oldEntries + entries;
        var totalBytes = pendingBytes - oldBytes + bytes;
        if (totalEntries + queuedEntries > EntryLimit || (totalBytes + queuedBytes > BufferLimit && Batches().Sum(b => (long)b.Bytes.Length) + queuedBytes > BufferLimit))
        {
            undo();
            Diagnose("buffer-limit");
            return;
        }
        pendingEntries = totalEntries;
        pendingBytes = totalBytes;
        periodic ??= PeriodicAsync();
    }
    private async Task PeriodicAsync()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                await Task.Delay((int)(interval * (0.8 + Random.Shared.NextDouble() * 0.4)), lifetime.Token).ConfigureAwait(false);
                await FlushTelemetryAsync().ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) { }
    }
    private byte[] Encode(Dictionary<string, Dictionary<string, long[]>> f, Dictionary<string, double> m)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("k", options.AppKey);
            writer.WriteString("e", options.Environment);
            if (f.Count > 0)
            {
                writer.WritePropertyName("f");
                JsonSerializer.Serialize(writer, f);
            }
            if (m.Count > 0)
            {
                writer.WritePropertyName("m");
                JsonSerializer.Serialize(writer, m);
            }
            writer.WriteEndObject();
        }
        return stream.ToArray();
    }
    private List<Batch> Batches()
    {
        var batches = new List<Batch>();
        Dictionary<string, Dictionary<string, long[]>> f = new(StringComparer.Ordinal);
        Dictionary<string, double> m = new(StringComparer.Ordinal);
        var count = 0;
        var created = now();
        void Finish()
        {
            if (count > 0)
                batches.Add(new(Encode(f, m), count, created));
            f = new(StringComparer.Ordinal);
            m = new(StringComparer.Ordinal);
            count = 0;
        }
        foreach (var (key, stored) in features.OrderBy(p => p.Key.Key, StringComparer.Ordinal).ThenBy(p => p.Key.Variant, StringComparer.Ordinal))
        {
            var remaining = stored.Value;
            for (var i = 0; i < stored.Entries; i++)
            {
                if (f.TryGetValue(key.Key, out var existing) && (existing.ContainsKey(key.Variant) || existing.Count >= 16))
                    Finish();
                var piece = remaining.First;
                void Insert()
                {
                    if (!f.TryGetValue(key.Key, out var variants))
                        f[key.Key] = variants = new(StringComparer.Ordinal);
                    variants[key.Variant] = piece.Values;
                    count++;
                }
                Insert();
                if (Encode(f, m).Length > EnvelopeLimit)
                {
                    f[key.Key].Remove(key.Variant);
                    if (f[key.Key].Count == 0)
                        f.Remove(key.Key);
                    count--;
                    Finish();
                    Insert();
                }
                remaining = new(remaining.Checks - piece.Checks, remaining.Used - piece.Used, remaining.Viewed - piece.Viewed);
            }
        }
        foreach (var (key, stored) in metrics.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            var remaining = stored.Value.Value;
            for (var i = 0; i < stored.Entries; i++)
            {
                if (m.ContainsKey(key))
                    Finish();
                var piece = stored.Value.Counter ? Math.Min(remaining, ValueLimit) : remaining;
                m[key] = piece;
                count++;
                if (Encode(f, m).Length > EnvelopeLimit)
                {
                    m.Remove(key);
                    count--;
                    Finish();
                    m[key] = piece;
                    count++;
                }
                remaining -= piece;
            }
        }
        Finish();
        return batches;
    }
    public Task FlushTelemetryAsync(CancellationToken cancellationToken = default) => FlushAsync(false).WaitAsync(cancellationToken);
    internal Task FlushAsync(bool keepalive)
    {
        TaskCompletionSource? completion = null;
        Task result;
        lock (sync)
        {
            if (!Enabled || closed)
                return Task.CompletedTask;
            if (disposed && finalAttempted)
                return flight ?? Task.CompletedTask;
            if (flight is null)
            {
                completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
                flight = completion.Task;
            }
            result = flight;
        }
        if (completion is not null)
            _ = DrainAsync(completion, keepalive);
        return result;
    }
    private async Task DrainAsync(TaskCompletionSource completion, bool keepalive)
    {
        try
        {
            while (true)
            {
                Batch batch;
                lock (sync)
                {
                    if (disposed && finalAttempted)
                        break;
                    if (queue.Count == 0)
                    {
                        if (pendingEntries == 0)
                            break;
                        foreach (var next in Batches())
                            queue.Enqueue(next);
                        queuedEntries = pendingEntries;
                        queuedBytes = queue.Sum(b => (long)b.Bytes.Length);
                        queuedKinds = metrics.ToDictionary(p => p.Key, p => p.Value.Value.Counter, StringComparer.Ordinal);
                        features.Clear();
                        metrics.Clear();
                        pendingEntries = 0;
                        pendingBytes = 0;
                    }
                    batch = queue.Peek();
                }
                if (now() - batch.CreatedAt < 300000)
                    await SendAsync(batch, keepalive).ConfigureAwait(false);
                lock (sync)
                {
                    if (queue.Count == 0 || !ReferenceEquals(queue.Peek(), batch))
                        break;
                    queue.Dequeue();
                    queuedEntries -= batch.Entries;
                    queuedBytes -= batch.Bytes.Length;
                    if (queue.Count == 0)
                        queuedKinds.Clear();
                }
            }
        }
        catch (Exception) { Diagnose("transport-failure"); }
        finally { lock (sync) flight = null; completion.TrySetResult(); }
    }
    private async Task SendAsync(Batch batch, bool keepalive)
    {
        bool final;
        lock (sync)
        {
            if (closed || disposed && finalAttempted)
                return;
            final = disposed;
            if (final)
                finalAttempted = true;
        }
        var bytes = batch.Bytes;
        var gzip = false;
        if (!final && !keepalive)
        {
            try
            {
                bytes = compress(bytes);
                gzip = true;
            }
            catch (Exception) { }
        }
        for (var attempt = 0; now() - batch.CreatedAt < 300000; attempt++)
        {
            FrontendTelemetryResponse response;
            using var requestLifetime = new CancellationTokenSource();
            IFrontendTelemetryTransport sender;
            lock (sync)
            {
                if (closed) return;
                if (disposed && !final)
                {
                    if (finalAttempted) return;
                    final = finalAttempted = true;
                    bytes = batch.Bytes;
                    gzip = false;
                }
                activeRequest = requestLifetime;
                sender = transport ??= ownedTransport = new NativeTelemetryTransport();
            }
            try
            {
                requestLifetime.Token.ThrowIfCancellationRequested();
                response = await sender.SendAsync(endpoint!, bytes, gzip, final || keepalive, requestLifetime.Token).WaitAsync(timeout, requestLifetime.Token).ConfigureAwait(false);
            }
            catch (Exception) { CancelRequest(requestLifetime); Diagnose("transport-failure"); return; }
            finally { lock (sync) activeRequest = null; }
            lock (sync)
            {
                if (response.StatusCode == 202)
                    return;
                if (disposed || response.StatusCode is not (429 or 503) || attempt == 2)
                {
                    Diagnose("http-failure");
                    return;
                }
            }
            var wait = Math.Max(attempt == 0 ? 30000 : 60000, RetryAfter(response.RetryAfter));
            if (wait >= 300000 - (now() - batch.CreatedAt))
                return;
            CancellationTokenSource sleep;
            lock (sync)
            {
                if (disposed)
                    return;
                retry = sleep = new();
            }
            try
            {
                await delay(wait, sleep.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { return; }
            finally { lock (sync) retry = null; sleep.Dispose(); }
            lock (sync)
            {
                if (disposed)
                    return;
            }
        }
    }
    private static int RetryAfter(string? raw)
    {
        if (double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) && double.IsFinite(seconds) && seconds >= 0)
            return (int)Math.Min(int.MaxValue, seconds * 1000);
        return DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date) ? (int)Math.Clamp((date - DateTimeOffset.UtcNow).TotalMilliseconds, 0, int.MaxValue) : 0;
    }
    public ValueTask DisposeAsync()
    {
        lock (sync)
        {
            if (disposal is not null)
                return new(disposal);
            disposed = true;
            lifetime.Cancel();
            retry?.Cancel();
            disposal = DisposeCoreAsync();
            return new(disposal);
        }
    }
    private async Task DisposeCoreAsync()
    {
        // Yield ensures teardown never invokes transport while holding the state lock.
        await Task.Yield();
        try
        {
            await FlushAsync(true).WaitAsync(timeout).ConfigureAwait(false);
        }
        catch (Exception) { }
        lock (sync)
        {
            closed = true;
            if (activeRequest is not null) CancelRequest(activeRequest);
            finalAttempted = true;
            features.Clear();
            metrics.Clear();
            queue.Clear();
            queuedKinds.Clear();
            pendingEntries = queuedEntries = 0;
            pendingBytes = queuedBytes = 0;
        }
        ownedTransport?.Dispose();
        lifetime.Dispose();
    }
    private static void CancelRequest(CancellationTokenSource request)
    {
        // Host transports may register callbacks; their errors must not prevent cleanup.
        try { request.Cancel(); } catch (Exception) { }
    }
    private void Diagnose(string code)
    {
        try
        {
            options.OnTelemetryDiagnostic?.Invoke(code);
        }
        catch (Exception) { }
    }
    private static byte[] Gzip(byte[] bytes)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Fastest, true))
            gzip.Write(bytes);
        return output.ToArray();
    }
}
