using System.Buffers.Binary;
using System.Text;

namespace Toggly.CLI.UnleashMigration;

/// <summary>
/// Unleash-compatible murmur3/32 stickiness helpers for percentage rollouts.
/// </summary>
/// <remarks>
/// <para>
/// Algorithm (Unleash client SDKs — Node <c>normalizedStrategyValue</c> / Java <c>StrategyUtils.getNormalizedNumber</c>):
/// <c>normalized = (murmur3_x86_32("{groupId}:{id}", seed=0) as uint % normalizer) + 1</c>
/// with <c>normalizer = 100</c> for gradual / flexible rollout. A context id is in the rollout when
/// <c>normalized &lt;= percentage</c>.
/// </para>
/// <para>
/// <b>Supported stickiness modes (v1):</b> <c>userId</c> and <c>default</c>
/// (<c>default</c> resolves to userId when present, otherwise sessionId).
/// </para>
/// <para>
/// <b>Unsupported modes (documented fidelity gaps):</b> explicit <c>sessionId</c>, <c>random</c>,
/// and custom context-field stickiness. These return null from <see cref="ResolveStickinessId"/>;
/// recommend freezing percentage rollouts during cutover when parity is uncertain.
/// Variant stickiness uses a different Unleash seed (86028157) and is not implemented here.
/// </para>
/// </remarks>
public static class UnleashStickiness
{
    /// <summary>Default Unleash strategy normalization modulus (1–100 inclusive buckets).</summary>
    public const int StrategyNormalizer = 100;

    /// <summary>Unleash strategy hash seed (0).</summary>
    public const uint StrategySeed = 0;

    /// <summary>
    /// Returns whether the stickiness mode is supported for bucket-parity helpers in v1.
    /// </summary>
    public static bool IsStickinessSupported(string? stickiness)
    {
        if (string.IsNullOrWhiteSpace(stickiness))
            return true; // Unleash treats missing as default

        return stickiness.Equals("userId", StringComparison.OrdinalIgnoreCase)
               || stickiness.Equals("default", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Resolves the identifier used for stickiness hashing.
    /// Returns null for unsupported modes (sessionId, random, custom fields).
    /// </summary>
    public static string? ResolveStickinessId(string? stickiness, string? userId, string? sessionId)
    {
        var mode = string.IsNullOrWhiteSpace(stickiness) ? "default" : stickiness.Trim();

        if (mode.Equals("userId", StringComparison.OrdinalIgnoreCase))
            return string.IsNullOrEmpty(userId) ? null : userId;

        if (mode.Equals("default", StringComparison.OrdinalIgnoreCase))
        {
            if (!string.IsNullOrEmpty(userId))
                return userId;
            if (!string.IsNullOrEmpty(sessionId))
                return sessionId;
            return null;
        }

        // Unsupported: sessionId, random, custom context fields
        return null;
    }

    /// <summary>
    /// Unleash strategy stickiness bucket in 1..100 for the given id and groupId.
    /// </summary>
    public static int NormalizedStrategyValue(string id, string groupId, int normalizer = StrategyNormalizer)
    {
        ArgumentNullException.ThrowIfNull(id);
        ArgumentNullException.ThrowIfNull(groupId);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(normalizer);

        var hash = Murmur3X86_32(Encoding.UTF8.GetBytes($"{groupId}:{id}"), StrategySeed);
        return (int)(hash % (uint)normalizer) + 1;
    }

    /// <summary>
    /// Returns true when Unleash would include the id in a rollout of <paramref name="percentage"/> (0–100).
    /// </summary>
    public static bool IsInRollout(string id, string groupId, int percentage)
    {
        if (percentage <= 0)
            return false;
        if (percentage >= 100)
            return true;

        return NormalizedStrategyValue(id, groupId) <= percentage;
    }

    /// <summary>
    /// MurmurHash3 x86 32-bit (seed typically 0 for Unleash strategies).
    /// </summary>
    public static uint Murmur3X86_32(ReadOnlySpan<byte> data, uint seed = StrategySeed)
    {
        const uint c1 = 0xcc9e2d51;
        const uint c2 = 0x1b873593;

        uint h1 = seed;
        int length = data.Length;
        int roundedEnd = length & ~3;

        for (int i = 0; i < roundedEnd; i += 4)
        {
            uint k1 = BinaryPrimitives.ReadUInt32LittleEndian(data[i..]);
            k1 *= c1;
            k1 = RotateLeft(k1, 15);
            k1 *= c2;

            h1 ^= k1;
            h1 = RotateLeft(h1, 13);
            h1 = h1 * 5 + 0xe6546b64;
        }

        uint k1Tail = 0;
        int tailLength = length & 3;
        if (tailLength >= 3)
            k1Tail ^= (uint)data[roundedEnd + 2] << 16;
        if (tailLength >= 2)
            k1Tail ^= (uint)data[roundedEnd + 1] << 8;
        if (tailLength >= 1)
        {
            k1Tail ^= data[roundedEnd];
            k1Tail *= c1;
            k1Tail = RotateLeft(k1Tail, 15);
            k1Tail *= c2;
            h1 ^= k1Tail;
        }

        h1 ^= (uint)length;
        h1 = FMix(h1);
        return h1;
    }

    private static uint RotateLeft(uint x, int r) => (x << r) | (x >> (32 - r));

    private static uint FMix(uint h)
    {
        h ^= h >> 16;
        h *= 0x85ebca6b;
        h ^= h >> 13;
        h *= 0xc2b2ae35;
        h ^= h >> 16;
        return h;
    }
}
