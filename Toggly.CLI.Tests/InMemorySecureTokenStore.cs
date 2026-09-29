using Toggly.CLI.Models;
using Toggly.CLI.Services;

namespace Toggly.CLI.Tests;

/// <summary>
/// In-memory <see cref="ISecureTokenStore"/> for unit tests.
/// </summary>
public sealed class InMemorySecureTokenStore : ISecureTokenStore
{
    private AuthSession? session;

    public CancellationToken LastSaveToken { get; private set; }
    public CancellationToken LastLoadToken { get; private set; }
    public CancellationToken LastDeleteToken { get; private set; }

    public Task SaveAsync(AuthSession session, CancellationToken cancellationToken = default)
    {
        LastSaveToken = cancellationToken;
        this.session = Clone(session);
        return Task.CompletedTask;
    }

    public Task<AuthSession?> LoadAsync(CancellationToken cancellationToken = default)
    {
        LastLoadToken = cancellationToken;
        return Task.FromResult(session is null ? null : Clone(session));
    }

    public Task DeleteAsync(CancellationToken cancellationToken = default)
    {
        LastDeleteToken = cancellationToken;
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
