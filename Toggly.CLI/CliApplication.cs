using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Commands;
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
    /// <returns>The configured root command.</returns>
    public static RootCommand CreateRootCommand(Func<InvocationContext, TogglyApiClient>? apiClientFactory = null)
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

        rootCommand.AddGlobalOption(clientIdOption);
        rootCommand.AddGlobalOption(clientSecretOption);
        rootCommand.AddGlobalOption(authorityOption);
        rootCommand.AddGlobalOption(baseUrlOption);
        rootCommand.AddGlobalOption(verboseOption);

        apiClientFactory ??= context => CreateApiClient(
            context,
            clientIdOption,
            clientSecretOption,
            authorityOption,
            baseUrlOption);

        rootCommand.AddCommand(ReleaseCommands.CreateReleaseCommand(apiClientFactory));
        rootCommand.AddCommand(ReleaseCommands.CreateAssociateBuildCommand(apiClientFactory));
        rootCommand.AddCommand(FeatureCommands.CreateFeatureCommand(apiClientFactory));
        rootCommand.AddCommand(FeatureCommands.CreateUpdateFeatureCommand(apiClientFactory));
        rootCommand.AddCommand(EnvironmentCommands.CreateUpdateFeatureEnvironmentCommand(apiClientFactory));

        return rootCommand;
    }

    private static TogglyApiClient CreateApiClient(
        InvocationContext context,
        Option<string?> clientIdOption,
        Option<string?> clientSecretOption,
        Option<string?> authorityOption,
        Option<string?> baseUrlOption)
    {
        var configService = new ConfigService();
        var config = configService.LoadConfig(
            clientId: context.ParseResult.GetValueForOption(clientIdOption),
            clientSecret: context.ParseResult.GetValueForOption(clientSecretOption),
            authority: context.ParseResult.GetValueForOption(authorityOption),
            baseUrl: context.ParseResult.GetValueForOption(baseUrlOption));

        try
        {
            configService.ValidateAuthConfig(config);
        }
        catch (InvalidOperationException ex)
        {
            Console.Error.WriteLine($"Authentication error: {ex.Message}");
            Console.Error.WriteLine("Use --help for more information.");
            context.ExitCode = 2;
            throw;
        }

        var httpClient = new HttpClient();
        var authService = new AuthService(httpClient);
        return new TogglyApiClient(
            httpClient,
            authService,
            config.BaseUrl,
            config.ClientId,
            config.ClientSecret,
            config.Authority);
    }
}
