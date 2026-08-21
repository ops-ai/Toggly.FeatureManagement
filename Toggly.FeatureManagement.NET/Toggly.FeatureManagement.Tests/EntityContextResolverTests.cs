using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Collections.Generic;
using Toggly.FeatureManagement.Configuration;
using Toggly.FeatureManagement.Context;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class EntityContextResolverTests
{
    private sealed class Puppy
    {
        public int Id { get; set; }
        public string Color { get; set; } = string.Empty;
    }

    [Fact]
    public void TryResolve_UsesSchemaProperties()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTogglyEntityContext<Puppy>(
            "Puppy",
            p => p.Id.ToString(),
            builder => builder
                .KeyProperty("Id")
                .Property("Id", "number")
                .Property("Color", "string"));

        var provider = services.BuildServiceProvider();
        var resolver = provider.GetRequiredService<ITogglyEntityContextResolver>();

        resolver.TryResolve(new Puppy { Id = 7, Color = "red" }, out var context).Should().BeTrue();
        context!.Kind.Should().Be("Puppy");
        context.Key.Should().Be("7");
        context.Attributes["Color"].Should().Be("red");
    }

    [Fact]
    public void TryResolve_UnregisteredType_FailsClosed()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<ITogglyEntityContextResolver>(sp =>
        {
            var registry = new EntityContextRegistry();
            return new TogglyEntityContextResolver(registry, sp.GetRequiredService<ILogger<TogglyEntityContextResolver>>());
        });

        var resolver = services.BuildServiceProvider().GetRequiredService<ITogglyEntityContextResolver>();
        resolver.TryResolve(new Puppy { Id = 1 }, out var context).Should().BeFalse();
        context.Should().BeNull();
    }

    [Fact]
    public void TryResolve_ExplicitAttributeMap_OverridesSchema()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTogglyEntityContext<Puppy>(
            "Puppy",
            p => p.Id.ToString(),
            builder => builder
                .KeyProperty("Id")
                .Property("Color", "string")
                .MapAttributes(p => new Dictionary<string, object?> { ["Color"] = p.Color.ToUpperInvariant() }));

        var resolver = services.BuildServiceProvider().GetRequiredService<ITogglyEntityContextResolver>();
        resolver.TryResolve(new Puppy { Id = 1, Color = "red" }, out var context).Should().BeTrue();
        context!.Attributes["Color"].Should().Be("RED");
    }

    [Fact]
    public void TryResolve_NullInstance_FailsClosed()
    {
        var resolver = CreateResolver();
        Puppy? puppy = null;
        resolver.TryResolve(puppy, out var context).Should().BeFalse();
        context.Should().BeNull();
    }

    [Fact]
    public void TryResolve_PassesThroughEntityAndEvaluationContext()
    {
        var resolver = CreateResolver();
        var entity = new TogglyEntityContext("Puppy", "1", new Dictionary<string, object?>());
        resolver.TryResolve(entity, out var resolved).Should().BeTrue();
        resolved.Should().BeSameAs(entity);

        resolver.TryResolve(new TogglyEvaluationContext(entity), out var fromEval).Should().BeTrue();
        fromEval.Should().BeSameAs(entity);

        resolver.TryResolve(new TogglyEvaluationContext(), out var emptyEval).Should().BeFalse();
        emptyEval.Should().BeNull();
    }

    private static ITogglyEntityContextResolver CreateResolver()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<ITogglyEntityContextResolver>(sp =>
            new TogglyEntityContextResolver(
                new EntityContextRegistry(),
                sp.GetRequiredService<ILogger<TogglyEntityContextResolver>>()));
        return services.BuildServiceProvider().GetRequiredService<ITogglyEntityContextResolver>();
    }
}
