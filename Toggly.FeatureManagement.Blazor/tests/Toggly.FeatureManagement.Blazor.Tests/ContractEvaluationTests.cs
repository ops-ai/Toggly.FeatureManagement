using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Bunit;
using FluentAssertions;
using Microsoft.AspNetCore.Components;
using Microsoft.Extensions.DependencyInjection;
using Toggly.FeatureManagement.Blazor;
using Toggly.FeatureManagement.Client;
using Toggly.FeatureManagement.Client.Desktop;
using Xunit;

namespace Blazor.Tests;

/// <summary>
/// Exercises Feature gates against the real Toggly definitions HTTP contract (mocked transport).
/// </summary>
public class ContractEvaluationTests : BlazorTestContext
{
    [Fact]
    public async Task FeatureGateRendersFromSignedDefinitionsContract()
    {
        using var fixture = new SignedDefinitionsFixture();
        using var http = new HttpClient(
            new ContractHandler(
                (request, _) =>
                {
                    var path = request.RequestUri!.AbsolutePath;
                    var body = path.Contains("jwks", StringComparison.OrdinalIgnoreCase)
                        ? fixture.Jwks
                        : fixture.Envelope(
                            """{"new-dashboard":true,"beta-banner":false,"checkout-v2":true}"""
                        );
                    return Task.FromResult(Ok(body));
                }
            )
        );

        await using var session = CreateSession(http, fixture.Jwks);
        Services.AddSingleton<IFeatureSession>(session);
        await session.InitializeAsync();

        var cut = Render(PairedGate("new-dashboard"));
        cut.WaitForAssertion(() => cut.Markup.Should().Be("enabled"));

        var off = Render(PairedGate("beta-banner"));
        off.WaitForAssertion(() => off.Markup.Should().Be("disabled"));
    }

    [Fact]
    public async Task MultiKeyAnyAllAndNegateMatchContractEvaluation()
    {
        using var fixture = new SignedDefinitionsFixture();
        using var http = new HttpClient(
            new ContractHandler(
                (_, _) =>
                    Task.FromResult(
                        Ok(
                            fixture.Envelope(
                                """{"alpha":true,"beta":false,"gamma":true}"""
                            )
                        )
                    )
            )
        );

        await using var session = CreateSession(http, fixture.Jwks);
        Services.AddSingleton<IFeatureSession>(session);
        await session.InitializeAsync();

        (await session.EvaluateAsync(["alpha", "gamma"])).Should().BeTrue();
        (await session.EvaluateAsync(["alpha", "beta"])).Should().BeFalse();
        (await session.EvaluateAsync(["alpha", "beta"], Requirement.Any)).Should().BeTrue();
        (await session.EvaluateAsync(["beta"], negate: true)).Should().BeTrue();

        var anyCut = Render(
            PairedGate(keys: ["alpha", "beta"], requirement: Requirement.Any)
        );
        anyCut.WaitForAssertion(() => anyCut.Markup.Should().Be("enabled"));

        var allCut = Render(PairedGate(keys: ["alpha", "beta"]));
        allCut.WaitForAssertion(() => allCut.Markup.Should().Be("disabled"));
    }

    [Fact]
    public async Task ContextRefreshReevaluatesGatesFromNewSignedPayload()
    {
        using var fixture = new SignedDefinitionsFixture();
        var call = 0;
        using var http = new HttpClient(
            new ContractHandler(
                (_, _) =>
                {
                    var defs =
                        Interlocked.Increment(ref call) == 1
                            ? """{"promo":false}"""
                            : """{"promo":true}""";
                    return Task.FromResult(Ok(fixture.Envelope(defs)));
                }
            )
        );

        await using var session = CreateSession(http, fixture.Jwks);
        Services.AddSingleton<IFeatureSession>(session);
        await session.InitializeAsync();

        var cut = Render(PairedGate("promo"));
        cut.WaitForAssertion(() => cut.Markup.Should().Be("disabled"));

        await cut.InvokeAsync(
            () => session.SetContextAsync(new EvaluationContext { Identity = "alice" })
        );
        cut.WaitForAssertion(() => cut.Markup.Should().Be("enabled"));
    }

    [Fact]
    public async Task UnsignedDefinitionsNeverEnableGates()
    {
        using var http = new HttpClient(
            new ContractHandler(
                (_, _) =>
                    Task.FromResult(
                        Ok(
                            """{"defs":{"leaked":true},"timestamp":1,"signature":"bad","kid":"x"}"""
                        )
                    )
            )
        );

        await using var session = CreateSession(http, "{}");
        Services.AddSingleton<IFeatureSession>(session);
        await session.InitializeAsync();

        (await session.EvaluateAsync(["leaked"])).Should().BeFalse();
        var cut = Render(PairedGate("leaked"));
        cut.WaitForAssertion(() => cut.Markup.Should().Be("disabled"));
    }

    private static BrowserFeatureSession CreateSession(HttpClient http, string jwks) =>
        new(
            new TogglyClient(
                new TogglyClientOptions
                {
                    AppKey = "blazor-contract-test",
                    EnableTelemetry = false,
                    EnableLiveUpdates = false,
                    TrustedJwks = jwks,
                },
                http,
                new Es256SignatureVerifier()
            )
        );

    private static HttpResponseMessage Ok(string body)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        response.Headers.TryAddWithoutValidation("X-Definitions-Revision", "contract-1");
        return response;
    }

    private static RenderFragment PairedGate(
        string? key = null,
        IEnumerable<string>? keys = null,
        Requirement requirement = Requirement.All
    ) =>
        builder =>
        {
            builder.OpenComponent<Feature>(0);
            if (keys is null)
                builder.AddAttribute(1, nameof(Feature.Key), key);
            else
                builder.AddAttribute(1, nameof(Feature.Keys), keys);
            builder.AddAttribute(2, nameof(Feature.Requirement), requirement);
            builder.AddAttribute(3, nameof(Feature.Negate), false);
            builder.AddAttribute(
                4,
                nameof(Feature.ChildContent),
                (RenderFragment)(child => child.AddContent(0, "enabled"))
            );
            builder.AddAttribute(
                5,
                nameof(Feature.Loading),
                (RenderFragment)(child => child.AddContent(0, "loading"))
            );
            builder.CloseComponent();

            builder.OpenComponent<Feature>(10);
            if (keys is null)
                builder.AddAttribute(11, nameof(Feature.Key), key);
            else
                builder.AddAttribute(11, nameof(Feature.Keys), keys);
            builder.AddAttribute(12, nameof(Feature.Requirement), requirement);
            builder.AddAttribute(13, nameof(Feature.Negate), true);
            builder.AddAttribute(
                14,
                nameof(Feature.ChildContent),
                (RenderFragment)(child => child.AddContent(0, "disabled"))
            );
            builder.CloseComponent();
        };

    private sealed class ContractHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond
    ) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) => respond(request, cancellationToken);
    }

    private sealed class SignedDefinitionsFixture : IDisposable
    {
        private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

        public string Kid { get; }
        public string Jwks { get; }

        public SignedDefinitionsFixture()
        {
            var parameters = key.ExportParameters(false);
            Kid =
                Convert.ToHexString(
                    SHA1.HashData(parameters.Q.X!.Concat(parameters.Q.Y!).ToArray())
                ) + "ES256";
            Jwks = JsonSerializer.Serialize(
                new
                {
                    keys = new[]
                    {
                        new
                        {
                            kty = "EC",
                            crv = "P-256",
                            alg = "ES256",
                            kid = Kid,
                            x = Convert.ToBase64String(parameters.Q.X!),
                            y = Convert.ToBase64String(parameters.Q.Y!),
                        },
                    },
                }
            );
        }

        public string Envelope(string defs, long? timestamp = null)
        {
            var time = timestamp ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var digest = SHA256.HashData(
                SHA256.HashData(Encoding.UTF8.GetBytes(defs + "|" + time))
            );
            var signature = Convert.ToBase64String(
                key.SignHash(digest, DSASignatureFormat.IeeeP1363FixedFieldConcatenation)
            );
            return "{\"defs\":"
                + defs
                + ",\"timestamp\":"
                + time
                + ",\"signature\":\""
                + signature
                + "\",\"kid\":\""
                + Kid
                + "\"}";
        }

        public void Dispose() => key.Dispose();
    }
}
