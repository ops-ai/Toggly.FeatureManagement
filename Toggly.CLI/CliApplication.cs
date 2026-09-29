using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Commands;
using Toggly.CLI.Output;
using Toggly.CLI.Services;

namespace Toggly.CLI;

/// <summary>
/// Creates the Toggly CLI command tree and its default API client factory.
/// </summary>
public static class CliApplication
{
    /// <summary>
    /// Creates the root command for the Toggly CLI.
    /// </summary>
    /// <param name="apiClientFactory">Optional API client factory for command execution.</param>
    /// <param name="authDeps">Optional auth command dependencies for tests.</param>
    /// <param name="secureTokenStoreFactory">Optional OS credential store factory (tests).</param>
    /// <param name="contextStoreFactory">Optional context prefs store factory (tests).</param>
    /// <param name="outputWriter">Optional stdout writer (tests).</param>
    /// <param name="errorWriter">Optional stderr writer (tests).</param>
    /// <returns>The configured root command.</returns>
    public static RootCommand CreateRootCommand(
        Func<InvocationContext, TogglyApiClient?>? apiClientFactory = null,
        AuthCommandDeps? authDeps = null,
        Func<ISecureTokenStore>? secureTokenStoreFactory = null,
        Func<ContextStore>? contextStoreFactory = null,
        TextWriter? outputWriter = null,
        TextWriter? errorWriter = null)
    {
        var rootCommand = new RootCommand("Toggly CLI - Command-line interface for Toggly feature flag management");

        var clientIdOption = new Option<string?>(
            "--client-id",
            description: "OAuth2 client ID (or set TOGGLY_CLIENT_ID)");
        var clientSecretOption = new Option<string?>(
            "--client-secret",
            description: "OAuth2 client secret (or set TOGGLY_CLIENT_SECRET)");
        var authorityOption = new Option<string?>(
            "--authority",
            description: "OAuth2 authority URL (defaults to https://auth.toggly.io)");
        var baseUrlOption = new Option<string?>(
            "--base-url",
            description: "Base URL for Toggly API (defaults to https://app.toggly.io/api)");
        var verboseOption = new Option<bool>(
            "--verbose",
            description: "Enable verbose output");
        var jsonOption = new Option<bool>(
            "--json",
            description: "Emit machine-readable JSON instead of human text");

        rootCommand.AddGlobalOption(clientIdOption);
        rootCommand.AddGlobalOption(clientSecretOption);
        rootCommand.AddGlobalOption(authorityOption);
        rootCommand.AddGlobalOption(baseUrlOption);
        rootCommand.AddGlobalOption(verboseOption);
        rootCommand.AddGlobalOption(jsonOption);

        var cli = new CliCommandContext
        {
            Output = new CommandOutput(jsonOption, outputWriter, errorWriter),
            ContextStoreFactory = contextStoreFactory ?? (() => new ContextStore())
        };

        apiClientFactory ??= context => CreateApiClient(
            context,
            clientIdOption,
            clientSecretOption,
            authorityOption,
            baseUrlOption,
            secureTokenStoreFactory);

        rootCommand.AddCommand(AuthCommands.Create(authDeps));
        rootCommand.AddCommand(AppCommands.Create(apiClientFactory, cli));
        rootCommand.AddCommand(EnvCommands.Create(apiClientFactory, cli));
        rootCommand.AddCommand(FeatureCommands.CreateNoun(apiClientFactory, cli));
        rootCommand.AddCommand(ReleaseCommands.CreateNoun(apiClientFactory, cli));
        rootCommand.AddCommand(ContextCommands.Create(cli));

        // Flat write aliases (deprecation window)
        rootCommand.AddCommand(FeatureCommands.CreateFeatureAlias(apiClientFactory, cli));
        rootCommand.AddCommand(FeatureCommands.CreateUpdateFeatureAlias(apiClientFactory, cli));
        rootCommand.AddCommand(FeatureCommands.CreateUpdateFeatureEnvironmentAlias(apiClientFactory, cli));
        rootCommand.AddCommand(ReleaseCommands.CreateReleaseAlias(apiClientFactory, cli));
        rootCommand.AddCommand(ReleaseCommands.CreateAssociateBuildAlias(apiClientFactory, cli));

        return rootCommand;
    }

    private static TogglyApiClient? CreateApiClient(
        InvocationContext context,
        Option<string?> clientIdOption,
        Option<string?> clientSecretOption,
        Option<string?> authorityOption,
        Option<string?> baseUrlOption,
        Func<ISecureTokenStore>? secureTokenStoreFactory)
    {
        var configService = new ConfigService();
        var config = configService.LoadConfig(
            clientId: context.ParseResult.GetValueForOption(clientIdOption),
            clientSecret: context.ParseResult.GetValueForOption(clientSecretOption),
            authority: context.ParseResult.GetValueForOption(authorityOption),
            baseUrl: context.ParseResult.GetValueForOption(baseUrlOption));

        ISecureTokenStore? tokenStore = null;
        try
        {
            tokenStore = secureTokenStoreFactory?.Invoke() ?? SecureTokenStore.Create();
        }
        catch (Exception ex) when (ex is PlatformNotSupportedException or InvalidOperationException)
        {
            // Store may be unavailable on headless Linux; client credentials can still work.
            tokenStore = null;
        }

        ResolvedCredentials credentials;
        try
        {
            credentials = CredentialResolver.ResolveAsync(
                config.ClientId,
                config.ClientSecret,
                config.Authority,
                tokenStore ?? new NullSecureTokenStore()).GetAwaiter().GetResult();
        }
        catch (InvalidOperationException ex)
        {
            // Do not rethrow — System.CommandLine would override ExitCode 2 with 1.
            Console.Error.WriteLine($"Authentication error: {ex.Message}");
            Console.Error.WriteLine("Use --help for more information.");
            context.ExitCode = 2;
            return null;
        }

        var httpClient = new HttpClient();
        var authService = new AuthService(httpClient);
        return new TogglyApiClient(
            httpClient,
            authService,
            config.BaseUrl,
            credentials,
            tokenStore);
    }

    /// <summary>
    /// Empty store used when the OS credential store cannot be opened (CI client-credentials still works).
    /// </summary>
    private sealed class NullSecureTokenStore : ISecureTokenStore
    {
        public Task SaveAsync(Models.AuthSession session, CancellationToken cancellationToken = default)
            => throw new InvalidOperationException("OS credential store is unavailable.");

        public Task<Models.AuthSession?> LoadAsync(CancellationToken cancellationToken = default)
            => Task.FromResult<Models.AuthSession?>(null);

        public Task DeleteAsync(CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}
