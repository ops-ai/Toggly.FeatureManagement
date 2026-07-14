namespace Toggly.CLI.Models;

/// <summary>
/// In-memory configuration for Toggly CLI (CLI args + environment variables only).
/// </summary>
public class TogglyConfig
{
    /// <summary>
    /// OAuth2 client ID
    /// </summary>
    public string? ClientId { get; set; }

    /// <summary>
    /// OAuth2 client secret
    /// </summary>
    public string? ClientSecret { get; set; }

    /// <summary>
    /// OAuth2 authority URL (optional, defaults to https://auth.toggly.io)
    /// </summary>
    public string? Authority { get; set; }

    /// <summary>
    /// Base URL for Toggly API (defaults to https://app.toggly.io/api)
    /// </summary>
    public string BaseUrl { get; set; } = "https://app.toggly.io/api";
}

