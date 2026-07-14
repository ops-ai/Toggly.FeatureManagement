using System.CommandLine;
using System.CommandLine.Invocation;
using Toggly.CLI.Commands;
using Toggly.CLI.Services;

var rootCommand = new RootCommand("Toggly CLI - Command-line interface for Toggly feature flag management");

// Global options
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

// Create a factory function for API client that reads from context
TogglyApiClient CreateApiClient(InvocationContext context)
{
    // Get global options from context
    var clientId = context.ParseResult.GetValueForOption(clientIdOption);
    var clientSecret = context.ParseResult.GetValueForOption(clientSecretOption);
    var authority = context.ParseResult.GetValueForOption(authorityOption);
    var baseUrl = context.ParseResult.GetValueForOption(baseUrlOption);

    // Load configuration
    var configService = new ConfigService();
    var config = configService.LoadConfig(
        clientId: clientId,
        clientSecret: clientSecret,
        authority: authority,
        baseUrl: baseUrl);

    // Validate authentication
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

    // Setup services
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

// Register subcommands
rootCommand.AddCommand(ReleaseCommands.CreateReleaseCommand(CreateApiClient));
rootCommand.AddCommand(ReleaseCommands.CreateAssociateBuildCommand(CreateApiClient));
rootCommand.AddCommand(FeatureCommands.CreateFeatureCommand(CreateApiClient));
rootCommand.AddCommand(FeatureCommands.CreateUpdateFeatureCommand(CreateApiClient));
rootCommand.AddCommand(EnvironmentCommands.CreateUpdateFeatureEnvironmentCommand(CreateApiClient));

// Parse and invoke
return await rootCommand.InvokeAsync(args);

