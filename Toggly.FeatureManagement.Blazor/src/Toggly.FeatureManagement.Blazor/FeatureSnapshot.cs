using Toggly.FeatureManagement.Client;
namespace Toggly.FeatureManagement.Blazor;
/// <summary>Only public boolean presentation state. Never use hydration as authorization.</summary>
public sealed class FeatureSnapshot
{
    public IReadOnlyDictionary<string,bool> Values { get; }
    public FeatureSnapshot(IReadOnlyDictionary<string,bool> values, IEnumerable<string> publicKeys)
        => Values = publicKeys.Distinct().Where(values.ContainsKey).ToDictionary(k => k, k => values[k]);
    public bool TryEvaluate(IEnumerable<string> keys, Requirement requirement, bool negate, out bool result)
    {
        var requested = keys.ToArray(); result = false;
        if (requested.Any(k => !Values.ContainsKey(k))) return false;
        result = requested.Length == 0 || (requirement == Requirement.Any ? requested.Any(k => Values[k]) : requested.All(k => Values[k]));
        if (negate) result = !result;
        return true;
    }
}
