using System.Text.Json.Serialization;

namespace Toggly.CLI.Models;

/// <summary>
/// Non-secret CLI preferences (default app / env). Never store tokens or client secrets here.
/// </summary>
public sealed class ContextPrefs
{
    [JsonPropertyName("defaultApplicationId")]
    public string? DefaultApplicationId { get; set; }

    [JsonPropertyName("defaultEnvironment")]
    public string? DefaultEnvironment { get; set; }
}
