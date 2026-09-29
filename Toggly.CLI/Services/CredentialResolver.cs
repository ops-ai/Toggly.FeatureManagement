using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

public enum ResolvedAuthKind
{
    ClientCredentials,
    DeviceSession
}

public sealed class ResolvedCredentials
{
    public required ResolvedAuthKind Kind { get; init; }
    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }
    public string Authority { get; init; } = Constants.DefaultAuthority;
    public AuthSession? Session { get; init; }
}

/// <summary>
/// Resolves CLI credentials: explicit client credentials win over OS-stored device sessions.
/// </summary>
public static class CredentialResolver
{
    public static async Task<ResolvedCredentials> ResolveAsync(
        string? clientId,
        string? clientSecret,
        string? authority,
        ISecureTokenStore tokenStore,
        CancellationToken cancellationToken = default)
    {
        var hasId = !string.IsNullOrEmpty(clientId);
        var hasSecret = !string.IsNullOrEmpty(clientSecret);

        if (hasSecret && !hasId)
        {
            throw new InvalidOperationException(
                "A client secret was provided without a client id. Provide --client-id (or TOGGLY_CLIENT_ID) " +
                "together with --client-secret / TOGGLY_CLIENT_SECRET.");
        }

        if (hasId && !hasSecret)
        {
            throw new InvalidOperationException(
                "A client id was provided without a client secret. Provide --client-secret (or TOGGLY_CLIENT_SECRET) " +
                "together with --client-id / TOGGLY_CLIENT_ID, or omit both and run 'toggly auth login'.");
        }

        if (hasId && hasSecret)
        {
            return new ResolvedCredentials
            {
                Kind = ResolvedAuthKind.ClientCredentials,
                ClientId = clientId,
                ClientSecret = clientSecret,
                Authority = ResolveAuthority(authority, sessionAuthority: null)
            };
        }

        var session = await tokenStore.LoadAsync(cancellationToken);
        if (session is not null && !string.IsNullOrEmpty(session.AccessToken))
        {
            return new ResolvedCredentials
            {
                Kind = ResolvedAuthKind.DeviceSession,
                ClientId = session.ClientId,
                Authority = ResolveAuthority(authority, session.Authority),
                Session = session
            };
        }

        throw new InvalidOperationException(
            "No authentication method available. Run 'toggly auth login' for interactive use, " +
            "or set TOGGLY_CLIENT_ID and TOGGLY_CLIENT_SECRET (or --client-id / --client-secret) for CI.");
    }

    private static string ResolveAuthority(string? explicitAuthority, string? sessionAuthority)
    {
        if (!string.IsNullOrEmpty(explicitAuthority))
            return explicitAuthority;

        if (!string.IsNullOrEmpty(sessionAuthority))
            return sessionAuthority;

        return Constants.DefaultAuthority;
    }
}
