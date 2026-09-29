using Toggly.CLI.Models;

namespace Toggly.CLI.Services;

/// <summary>
/// Persists auth sessions in the OS credential store (never plaintext files).
/// </summary>
public interface ISecureTokenStore
{
    Task SaveAsync(AuthSession session, CancellationToken cancellationToken = default);

    Task<AuthSession?> LoadAsync(CancellationToken cancellationToken = default);

    Task DeleteAsync(CancellationToken cancellationToken = default);
}
