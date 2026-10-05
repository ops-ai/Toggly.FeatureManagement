using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.FeatureManagement;
using Moq;
using Toggly.FeatureManagement.Helpers;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class HelpersServiceCollectionExtensionsTests
{
    #region Test Interfaces and Implementations

    public interface ITestService
    {
        string GetValue();
    }

    public class TestServiceA : ITestService
    {
        public string GetValue() => "A";
    }

    public class TestServiceB : ITestService
    {
        public string GetValue() => "B";
    }

    public class TestDependency
    {
    }

    public class DependentTestService : ITestService
    {
        public TestDependency Dependency { get; }

        public DependentTestService(TestDependency dependency)
        {
            Dependency = dependency;
        }

        public string GetValue() => "Dependent";
    }

    public class TestDecorator : ITestService
    {
        private readonly ITestService _inner;

        public TestDecorator(ITestService inner)
        {
            _inner = inner;
        }

        public string GetValue() => $"Decorated({_inner.GetValue()})";
    }

    public enum TestFeatures
    {
        FeatureA,
        FeatureB
    }

    #endregion

    #region Feature registration fallback contracts

    [Theory]
    [InlineData(ServiceLifetime.Transient, false)]
    [InlineData(ServiceLifetime.Transient, true)]
    [InlineData(ServiceLifetime.Scoped, false)]
    [InlineData(ServiceLifetime.Scoped, true)]
    public void FeatureRegistration_WhenDisabled_InvokesFallbackFactoryWithResolvingScope(
        ServiceLifetime lifetime, bool useEnum)
    {
        var services = new ServiceCollection();
        services.AddScoped<TestDependency>();
        var factoryCalls = 0;
        ((IServiceCollection)services).Add(ServiceDescriptor.Describe(typeof(ITestService), provider =>
        {
            factoryCalls++;
            return new DependentTestService(provider.GetRequiredService<TestDependency>());
        }, ServiceLifetime.Singleton));
        var featureManager = AddDisabledFeatureManager(services, useEnum);

        RegisterForFeature(services, lifetime, useEnum);
        services.Single(descriptor => descriptor.ServiceType == typeof(ITestService))
            .Lifetime.Should().Be(lifetime);
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        using var firstScope = provider.CreateScope();
        using var secondScope = provider.CreateScope();

        var first = firstScope.ServiceProvider.GetRequiredService<ITestService>();
        var repeat = firstScope.ServiceProvider.GetRequiredService<ITestService>();
        var second = secondScope.ServiceProvider.GetRequiredService<ITestService>();

        first.Should().BeOfType<DependentTestService>().Which.Dependency.Should()
            .BeSameAs(firstScope.ServiceProvider.GetRequiredService<TestDependency>());
        second.Should().BeOfType<DependentTestService>().Which.Dependency.Should()
            .BeSameAs(secondScope.ServiceProvider.GetRequiredService<TestDependency>());
        AssertResolutionLifetime(first, repeat, second, lifetime);
        var expectedResolutions = lifetime == ServiceLifetime.Scoped ? 2 : 3;
        factoryCalls.Should().Be(expectedResolutions);
        featureManager.Verify(manager => manager.IsEnabledAsync(GetFeatureName(useEnum)), Times.Exactly(expectedResolutions));
        featureManager.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(ServiceLifetime.Transient, false)]
    [InlineData(ServiceLifetime.Transient, true)]
    [InlineData(ServiceLifetime.Scoped, false)]
    [InlineData(ServiceLifetime.Scoped, true)]
    public void FeatureRegistration_WhenDisabled_ActivatesFallbackTypeInsteadOfResolvingRegisteredConcrete(
        ServiceLifetime lifetime, bool useEnum)
    {
        var services = new ServiceCollection();
        services.AddScoped<TestDependency>();
        var registeredConcrete = new DependentTestService(new TestDependency());
        services.AddSingleton(registeredConcrete);
        ((IServiceCollection)services).Add(ServiceDescriptor.Describe(typeof(ITestService), typeof(DependentTestService), ServiceLifetime.Singleton));
        var featureManager = AddDisabledFeatureManager(services, useEnum);

        RegisterForFeature(services, lifetime, useEnum);
        services.Single(descriptor => descriptor.ServiceType == typeof(ITestService))
            .Lifetime.Should().Be(lifetime);
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        using var firstScope = provider.CreateScope();
        using var secondScope = provider.CreateScope();

        var first = firstScope.ServiceProvider.GetRequiredService<ITestService>();
        var repeat = firstScope.ServiceProvider.GetRequiredService<ITestService>();
        var second = secondScope.ServiceProvider.GetRequiredService<ITestService>();

        first.Should().NotBeSameAs(registeredConcrete);
        first.Should().BeOfType<DependentTestService>().Which.Dependency.Should()
            .BeSameAs(firstScope.ServiceProvider.GetRequiredService<TestDependency>());
        second.Should().BeOfType<DependentTestService>().Which.Dependency.Should()
            .BeSameAs(secondScope.ServiceProvider.GetRequiredService<TestDependency>());
        AssertResolutionLifetime(first, repeat, second, lifetime);
        featureManager.Verify(manager => manager.IsEnabledAsync(GetFeatureName(useEnum)),
            Times.Exactly(lifetime == ServiceLifetime.Scoped ? 2 : 3));
        featureManager.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(ServiceLifetime.Transient, false)]
    [InlineData(ServiceLifetime.Transient, true)]
    [InlineData(ServiceLifetime.Scoped, false)]
    [InlineData(ServiceLifetime.Scoped, true)]
    public void FeatureRegistration_WhenDisabledWithoutFallback_PreservesException(
        ServiceLifetime lifetime, bool useEnum)
    {
        var services = new ServiceCollection();
        var featureManager = AddDisabledFeatureManager(services, useEnum);
        RegisterForFeature(services, lifetime, useEnum);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var resolve = () => scope.ServiceProvider.GetRequiredService<ITestService>();

        resolve.Should().ThrowExactly<NotImplementedException>().WithMessage(
            $"Feature {GetFeatureName(useEnum)} is not enabled, and no other instance of the service is registered");
        featureManager.Verify(manager => manager.IsEnabledAsync(GetFeatureName(useEnum)), Times.Once);
        featureManager.VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(ServiceLifetime.Transient)]
    [InlineData(ServiceLifetime.Scoped)]
    public void FeatureRegistration_WhenDisabledWithInstanceFallback_PreservesUnsupportedDescriptorException(
        ServiceLifetime lifetime)
    {
        var services = new ServiceCollection();
        services.AddSingleton<ITestService>(new TestServiceA());
        AddDisabledFeatureManager(services, false);
        RegisterForFeature(services, lifetime, false);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var resolve = () => scope.ServiceProvider.GetRequiredService<ITestService>();

        resolve.Should().ThrowExactly<InvalidOperationException>().WithMessage("Unable to create instance");
    }

    [Theory]
    [InlineData(ServiceLifetime.Transient)]
    [InlineData(ServiceLifetime.Scoped)]
    public void FeatureRegistration_WhenFallbackFactoryThrows_PropagatesSameException(ServiceLifetime lifetime)
    {
        var services = new ServiceCollection();
        var expected = new ArgumentException("Fallback failed");
        services.AddTransient<ITestService>(_ => throw expected);
        AddDisabledFeatureManager(services, false);
        RegisterForFeature(services, lifetime, false);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var resolve = () => scope.ServiceProvider.GetRequiredService<ITestService>();

        resolve.Should().ThrowExactly<ArgumentException>().Which.Should().BeSameAs(expected);
    }

    private static string GetFeatureName(bool useEnum) => useEnum ? nameof(TestFeatures.FeatureA) : "CustomFeature";

    private static Mock<IFeatureManager> AddDisabledFeatureManager(ServiceCollection services, bool useEnum)
    {
        var featureManager = new Mock<IFeatureManager>(MockBehavior.Strict);
        featureManager.Setup(manager => manager.IsEnabledAsync(GetFeatureName(useEnum))).ReturnsAsync(false);
        services.AddSingleton(featureManager.Object);
        return featureManager;
    }

    private static void RegisterForFeature(ServiceCollection services, ServiceLifetime lifetime, bool useEnum)
    {
        if (lifetime == ServiceLifetime.Transient)
        {
            if (useEnum)
                services.AddTransientForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
            else
                services.AddTransientForFeature<ITestService, TestServiceB>("CustomFeature");
        }
        else if (useEnum)
            services.AddScopedForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        else
            services.AddScopedForFeature<ITestService, TestServiceB>("CustomFeature");
    }

    private static void AssertResolutionLifetime(ITestService first, ITestService repeat, ITestService second,
        ServiceLifetime lifetime)
    {
        if (lifetime == ServiceLifetime.Scoped)
            first.Should().BeSameAs(repeat);
        else
            first.Should().NotBeSameAs(repeat);
        first.Should().NotBeSameAs(second);
    }

    #endregion

    #region Decorate Tests

    [Fact]
    public void Decorate_WithRegisteredInterface_DecoatesService()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        // Act
        services.Decorate<ITestService, TestDecorator>();
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("Decorated(A)");
    }

    [Fact]
    public void Decorate_WithUnregisteredInterface_ThrowsInvalidOperationException()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var act = () => services.Decorate<ITestService, TestDecorator>();

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*{nameof(ITestService)}*not registered*");
    }

    [Fact]
    public void Decorate_WithSingletonLifetime_PreservesLifetime()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddSingleton<ITestService, TestServiceA>();

        // Act
        services.Decorate<ITestService, TestDecorator>();
        var provider = services.BuildServiceProvider();

        // Assert
        var instance1 = provider.GetRequiredService<ITestService>();
        var instance2 = provider.GetRequiredService<ITestService>();
        instance1.Should().BeSameAs(instance2);
    }

    [Fact]
    public void Decorate_WithTransientLifetime_PreservesLifetime()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        // Act
        services.Decorate<ITestService, TestDecorator>();
        var provider = services.BuildServiceProvider();

        // Assert
        var instance1 = provider.GetRequiredService<ITestService>();
        var instance2 = provider.GetRequiredService<ITestService>();
        instance1.Should().NotBeSameAs(instance2);
    }

    [Fact]
    public void Decorate_WithScopedLifetime_PreservesLifetime()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddScoped<ITestService, TestServiceA>();

        // Act
        services.Decorate<ITestService, TestDecorator>();
        var provider = services.BuildServiceProvider();

        // Assert
        using var scope1 = provider.CreateScope();
        using var scope2 = provider.CreateScope();

        var instance1a = scope1.ServiceProvider.GetRequiredService<ITestService>();
        var instance1b = scope1.ServiceProvider.GetRequiredService<ITestService>();
        var instance2 = scope2.ServiceProvider.GetRequiredService<ITestService>();

        instance1a.Should().BeSameAs(instance1b);
        instance1a.Should().NotBeSameAs(instance2);
    }

    #endregion

    #region DecorateForFeature (enum) Tests

    [Fact]
    public void DecorateForFeature_WithEnumFeature_WhenEnabled_ReturnsDecorated()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.DecorateForFeature<ITestService, TestDecorator>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("Decorated(A)");
    }

    [Fact]
    public void DecorateForFeature_WithEnumFeature_WhenDisabled_ReturnsOriginal()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.DecorateForFeature<ITestService, TestDecorator>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("A");
    }

    [Fact]
    public void DecorateForFeature_WithNonEnumObject_ThrowsArgumentException()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        // Act - passing an object that is not an enum (e.g., an int boxed as object)
        var act = () => services.DecorateForFeature<ITestService, TestDecorator>((object)123);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum*");
    }

    [Fact]
    public void DecorateForFeature_WithUnregisteredInterface_ThrowsInvalidOperationException()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var act = () => services.DecorateForFeature<ITestService, TestDecorator>(TestFeatures.FeatureA);

        // Assert
        act.Should().Throw<InvalidOperationException>()
            .WithMessage($"*{nameof(ITestService)}*not registered*");
    }

    #endregion

    #region DecorateForFeature (string) Tests

    [Fact]
    public void DecorateForFeature_WithStringFeature_WhenEnabled_ReturnsDecorated()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("MyFeature")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.DecorateForFeature<ITestService, TestDecorator>("MyFeature");
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("Decorated(A)");
    }

    [Fact]
    public void DecorateForFeature_WithStringFeature_WhenDisabled_ReturnsOriginal()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("MyFeature")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.DecorateForFeature<ITestService, TestDecorator>("MyFeature");
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("A");
    }

    #endregion

    #region AddTransientForFeature (enum) Tests

    [Fact]
    public void AddTransientForFeature_WithEnumFeature_WhenEnabled_ReturnsNewImplementation()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddTransientForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("B");
    }

    [Fact]
    public void AddTransientForFeature_WithEnumFeature_WhenDisabled_ReturnsFallback()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddTransientForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("A");
    }

    [Fact]
    public void AddTransientForFeature_WithNonEnumObject_ThrowsArgumentException()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act - passing an object that is not an enum (e.g., an int boxed as object)
        var act = () => services.AddTransientForFeature<ITestService, TestServiceB>((object)123);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum*");
    }

    [Fact]
    public void AddTransientForFeature_WithNoExistingRegistration_WhenDisabled_Throws()
    {
        // Arrange
        var services = new ServiceCollection();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddTransientForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        var act = () => provider.GetRequiredService<ITestService>();
        act.Should().Throw<NotImplementedException>();
    }

    [Fact]
    public void AddTransientForFeature_WithNoExistingRegistration_WhenEnabled_ReturnsNewImplementation()
    {
        // Arrange
        var services = new ServiceCollection();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddTransientForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("B");
    }

    #endregion

    #region AddTransientForFeature (string) Tests

    [Fact]
    public void AddTransientForFeature_WithStringFeature_WhenEnabled_ReturnsNewImplementation()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("MyFeature")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddTransientForFeature<ITestService, TestServiceB>("MyFeature");
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("B");
    }

    [Fact]
    public void AddTransientForFeature_WithStringFeature_WhenDisabled_ReturnsFallback()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddTransient<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("MyFeature")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddTransientForFeature<ITestService, TestServiceB>("MyFeature");
        var provider = services.BuildServiceProvider();

        // Assert
        var result = provider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("A");
    }

    #endregion

    #region AddScopedForFeature (enum) Tests

    [Fact]
    public void AddScopedForFeature_WithEnumFeature_WhenEnabled_ReturnsNewImplementation()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddScoped<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddScopedForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        using var scope = provider.CreateScope();
        var result = scope.ServiceProvider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("B");
    }

    [Fact]
    public void AddScopedForFeature_WithEnumFeature_WhenDisabled_ReturnsFallback()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddScoped<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddScopedForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        using var scope = provider.CreateScope();
        var result = scope.ServiceProvider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("A");
    }

    [Fact]
    public void AddScopedForFeature_WithNonEnumObject_ThrowsArgumentException()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act - passing an object that is not an enum (e.g., an int boxed as object)
        var act = () => services.AddScopedForFeature<ITestService, TestServiceB>((object)123);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum*");
    }

    [Fact]
    public void AddScopedForFeature_WithNoExistingRegistration_WhenDisabled_Throws()
    {
        // Arrange
        var services = new ServiceCollection();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("FeatureA")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddScopedForFeature<ITestService, TestServiceB>(TestFeatures.FeatureA);
        var provider = services.BuildServiceProvider();

        // Assert
        using var scope = provider.CreateScope();
        var act = () => scope.ServiceProvider.GetRequiredService<ITestService>();
        act.Should().Throw<NotImplementedException>();
    }

    #endregion

    #region AddScopedForFeature (string) Tests

    [Fact]
    public void AddScopedForFeature_WithStringFeature_WhenEnabled_ReturnsNewImplementation()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddScoped<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("MyFeature")).ReturnsAsync(true);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddScopedForFeature<ITestService, TestServiceB>("MyFeature");
        var provider = services.BuildServiceProvider();

        // Assert
        using var scope = provider.CreateScope();
        var result = scope.ServiceProvider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("B");
    }

    [Fact]
    public void AddScopedForFeature_WithStringFeature_WhenDisabled_ReturnsFallback()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddScoped<ITestService, TestServiceA>();

        var featureManagerMock = new Mock<IFeatureManager>();
        featureManagerMock.Setup(x => x.IsEnabledAsync("MyFeature")).ReturnsAsync(false);
        services.AddSingleton(featureManagerMock.Object);

        // Act
        services.AddScopedForFeature<ITestService, TestServiceB>("MyFeature");
        var provider = services.BuildServiceProvider();

        // Assert
        using var scope = provider.CreateScope();
        var result = scope.ServiceProvider.GetRequiredService<ITestService>();
        result.GetValue().Should().Be("A");
    }

    #endregion
}
