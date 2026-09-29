using Toggly.CLI.Models;
using Toggly.CLI.Services;

namespace Toggly.CLI.Tests;

/// <summary>
/// In-memory <see cref="ISecureTokenStore"/> for unit tests.
/// </summary>
public sealed class InMemorySecureTokenStore : ISecureTokenStore
{
    private AuthSession? session;

    public Task SaveAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        this.session = Clone(session);
        return Task.CompletedTask;
    }

    public Task<AuthSession?> LoadAsync(CancellationToken cancellationToken = default)
        => Task.FromResult(session is null ? null : Clone(session));

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        session = null;
        return Task.CompletedTask;
    }

    private static AuthSession Clone(AuthSession source) => new()
    {
        AccessToken = source.AccessToken,
        RefreshToken = source.RefreshToken,
        ExpiresAtUtc = source.ExpiresAtUtc,
        Authority = source.Authority,
        ClientId = source.ClientId,
        TokenType = source.TokenType
    };
}
