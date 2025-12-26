using System.Text.Json.Serialization;

namespace Toggly.CLI.Models;

/// <summary>
/// Configuration model for Toggly CLI
/// </summary>
public class TogglyConfig
{
    /// <summary>
    /// OAuth2 client ID
    /// </summary>
    [JsonPropertyName("clientId")]
    public string? ClientId { get; set; }

    /// <summary>
    /// OAuth2 client secret
    /// </summary>
    [JsonPropertyName("clientSecret")]
    public string? ClientSecret { get; set; }

    /// <summary>
    /// OAuth2 authority URL (optional, defaults to https://auth.toggly.io)
    /// </summary>
    [JsonPropertyName("authority")]
    public string? Authority { get; set; }

    /// <summary>
    /// Base URL for Toggly API (defaults to https://app.toggly.io/api)
    /// </summary>
    [JsonPropertyName("baseUrl")]
    public string BaseUrl { get; set; } = "https://app.toggly.io/api";
}

