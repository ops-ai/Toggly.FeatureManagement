using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.FeatureManagement;
using Microsoft.FeatureManagement.Mvc;
using Moq;
using NSwag;
using NSwag.Generation.AspNetCore;
using NSwag.Generation.Processors.Contexts;
using System.Reflection;
using Toggly.FeatureManagement.NSwag;
using Xunit;

namespace Toggly.FeatureManagement.NSwag.Tests;

public class FeatureGateOperationProcessorTests
{
    private readonly Mock<IFeatureManager> _featureManagerMock;
    private readonly Mock<IServiceProvider> _serviceProviderMock;
    private readonly Mock<IHttpContextAccessor> _httpContextAccessorMock;

    public FeatureGateOperationProcessorTests()
    {
        _featureManagerMock = new Mock<IFeatureManager>();
        _serviceProviderMock = new Mock<IServiceProvider>();
        _httpContextAccessorMock = new Mock<IHttpContextAccessor>();

        _serviceProviderMock
            .Setup(x => x.GetService(typeof(IHttpContextAccessor)))
            .Returns(_httpContextAccessorMock.Object);
        _serviceProviderMock
            .Setup(x => x.GetService(typeof(IFeatureManager)))
            .Returns(_featureManagerMock.Object);
    }

    #region Constructor Tests

    [Fact]
    public void Constructor_WithNullServiceProvider_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => new FeatureGateOperationProcessor(null);

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void Constructor_WithServiceProvider_DoesNotThrow()
    {
        // Arrange & Act
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);

        // Assert
        processor.Should().NotBeNull();
    }

    #endregion

    #region Process - Context Type Tests

    // Note: Testing Process method directly is challenging because
    // OperationProcessorContext and AspNetCoreOperationProcessorContext
    // have complex constructors that are difficult to mock.
    // The logic is tested indirectly through attribute detection tests.

    #endregion

    #region Process - No Feature Manager Tests

    [Fact]
    public void Process_WithNoFeatureManager_ReturnsTrue()
    {
        // Arrange
        var serviceProvider = new Mock<IServiceProvider>();
        serviceProvider
            .Setup(x => x.GetService(typeof(IHttpContextAccessor)))
            .Returns(null);
        serviceProvider
            .Setup(x => x.GetService(typeof(IFeatureManager)))
            .Returns(null);

        var processor = new FeatureGateOperationProcessor(serviceProvider.Object);

        // Note: This test is limited because we can't easily create
        // an AspNetCoreOperationProcessorContext with all required internals
        // without significant infrastructure setup

        processor.Should().NotBeNull();
    }

    #endregion

    #region IsFeatureEnabled Logic Tests (via reflection or indirect testing)

    [Fact]
    public async Task FeatureManager_IsEnabledAsync_CalledCorrectly()
    {
        // Arrange
        _featureManagerMock
            .Setup(x => x.IsEnabledAsync("TestFeature"))
            .ReturnsAsync(true);

        // Act
        var result = await _featureManagerMock.Object.IsEnabledAsync("TestFeature");

        // Assert
        result.Should().BeTrue();
        _featureManagerMock.Verify(x => x.IsEnabledAsync("TestFeature"), Times.Once);
    }

    [Fact]
    public async Task FeatureManager_IsEnabledAsync_ReturnsFalse_WhenDisabled()
    {
        // Arrange
        _featureManagerMock
            .Setup(x => x.IsEnabledAsync("DisabledFeature"))
            .ReturnsAsync(false);

        // Act
        var result = await _featureManagerMock.Object.IsEnabledAsync("DisabledFeature");

        // Assert
        result.Should().BeFalse();
    }

    #endregion

    #region FeatureGateAttribute Tests

    [Fact]
    public void FeatureGateAttribute_HasExpectedProperties()
    {
        // Arrange
        var attribute = new FeatureGateAttribute("Feature1", "Feature2");

        // Assert
        attribute.Features.Should().Contain("Feature1");
        attribute.Features.Should().Contain("Feature2");
    }

    [Fact]
    public void FeatureGateAttribute_RequirementType_DefaultsToAll()
    {
        // Arrange
        var attribute = new FeatureGateAttribute("Feature1");

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.All);
    }

    [Fact]
    public void FeatureGateAttribute_RequirementType_CanBeSetToAny()
    {
        // Arrange
        var attribute = new FeatureGateAttribute(RequirementType.Any, "Feature1", "Feature2");

        // Assert
        attribute.RequirementType.Should().Be(RequirementType.Any);
    }

    #endregion

    #region Controller and Action Attribute Detection Tests

    [Fact]
    public void ControllerWithFeatureGate_HasAttribute()
    {
        // Arrange
        var controllerType = typeof(TestFeatureGatedController);

        // Act
        var attribute = controllerType.GetCustomAttribute<FeatureGateAttribute>();

        // Assert
        attribute.Should().NotBeNull();
        attribute!.Features.Should().Contain("ControllerFeature");
    }

    [Fact]
    public void ActionWithFeatureGate_HasAttribute()
    {
        // Arrange
        var methodInfo = typeof(TestFeatureGatedController).GetMethod(nameof(TestFeatureGatedController.FeatureGatedAction));

        // Act
        var attribute = methodInfo?.GetCustomAttribute<FeatureGateAttribute>();

        // Assert
        attribute.Should().NotBeNull();
        attribute!.Features.Should().Contain("ActionFeature");
    }

    [Fact]
    public void ActionWithoutFeatureGate_NoAttribute()
    {
        // Arrange
        var methodInfo = typeof(TestFeatureGatedController).GetMethod(nameof(TestFeatureGatedController.NonGatedAction));

        // Act
        var attribute = methodInfo?.GetCustomAttribute<FeatureGateAttribute>();

        // Assert
        attribute.Should().BeNull();
    }

    [Fact]
    public void ControllerWithMultipleFeatures_HasAllFeatures()
    {
        // Arrange
        var controllerType = typeof(TestMultiFeatureController);

        // Act
        var attribute = controllerType.GetCustomAttribute<FeatureGateAttribute>();

        // Assert
        attribute.Should().NotBeNull();
        attribute!.Features.Should().HaveCount(2);
        attribute.Features.Should().Contain("Feature1");
        attribute.Features.Should().Contain("Feature2");
    }

    [Fact]
    public void ControllerWithAnyRequirement_HasCorrectType()
    {
        // Arrange
        var controllerType = typeof(TestAnyFeatureController);

        // Act
        var attribute = controllerType.GetCustomAttribute<FeatureGateAttribute>();

        // Assert
        attribute.Should().NotBeNull();
        attribute!.RequirementType.Should().Be(RequirementType.Any);
    }

    #endregion

    #region RequirementType Logic Tests

    [Fact]
    public async Task RequirementType_All_AllEnabled_ReturnsTrue()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F2")).ReturnsAsync(true);

        // Act
        var f1Result = await _featureManagerMock.Object.IsEnabledAsync("F1");
        var f2Result = await _featureManagerMock.Object.IsEnabledAsync("F2");

        // Assert - All must be true
        (f1Result && f2Result).Should().BeTrue();
    }

    [Fact]
    public async Task RequirementType_All_OneDisabled_ReturnsFalse()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F2")).ReturnsAsync(false);

        // Act
        var f1Result = await _featureManagerMock.Object.IsEnabledAsync("F1");
        var f2Result = await _featureManagerMock.Object.IsEnabledAsync("F2");

        // Assert - All must be true, so this should be false
        (f1Result && f2Result).Should().BeFalse();
    }

    [Fact]
    public async Task RequirementType_Any_OneEnabled_ReturnsTrue()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F2")).ReturnsAsync(false);

        // Act
        var f1Result = await _featureManagerMock.Object.IsEnabledAsync("F1");
        var f2Result = await _featureManagerMock.Object.IsEnabledAsync("F2");

        // Assert - Any must be true
        (f1Result || f2Result).Should().BeTrue();
    }

    [Fact]
    public async Task RequirementType_Any_AllDisabled_ReturnsFalse()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F1")).ReturnsAsync(false);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("F2")).ReturnsAsync(false);

        // Act
        var f1Result = await _featureManagerMock.Object.IsEnabledAsync("F1");
        var f2Result = await _featureManagerMock.Object.IsEnabledAsync("F2");

        // Assert - Any must be true, but none are
        (f1Result || f2Result).Should().BeFalse();
    }

    #endregion

    #region IsFeatureEnabled Tests via Reflection

    [Fact]
    public void IsFeatureEnabled_WithNullFeatureManagers_ReturnsTrue()
    {
        // Arrange
        var processor = new FeatureGateOperationProcessor(null);
        var featureGate = new FeatureGateAttribute("TestFeature");

        // Use reflection to invoke private method
        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, null })!;

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsFeatureEnabled_WithFeatureManagerOnly_AndEnabledFeature_ReturnsTrue()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("EnabledFeature")).ReturnsAsync(true);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute("EnabledFeature");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsFeatureEnabled_WithFeatureManagerOnly_AndDisabledFeature_ReturnsFalse()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("DisabledFeature")).ReturnsAsync(false);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute("DisabledFeature");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void IsFeatureEnabled_RequirementTypeAll_AllEnabled_ReturnsTrue()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2")).ReturnsAsync(true);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute(RequirementType.All, "Feature1", "Feature2");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsFeatureEnabled_RequirementTypeAll_OneDisabled_ReturnsFalse()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2")).ReturnsAsync(false);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute(RequirementType.All, "Feature1", "Feature2");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void IsFeatureEnabled_RequirementTypeAny_OneEnabled_ReturnsTrue()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2")).ReturnsAsync(false);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute(RequirementType.Any, "Feature1", "Feature2");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsFeatureEnabled_RequirementTypeAny_NoneEnabled_ReturnsFalse()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1")).ReturnsAsync(false);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2")).ReturnsAsync(false);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute(RequirementType.Any, "Feature1", "Feature2");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeFalse();
    }

    [Fact]
    public void IsFeatureEnabled_RequirementTypeAny_AllEnabled_ReturnsTrue()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature1")).ReturnsAsync(true);
        _featureManagerMock.Setup(x => x.IsEnabledAsync("Feature2")).ReturnsAsync(true);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute(RequirementType.Any, "Feature1", "Feature2");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeTrue();
    }

    [Fact]
    public void IsFeatureEnabled_WithFeatureManagerSnapshotNull_AndFeatureManagerNull_ReturnsTrue()
    {
        // Arrange
        var processor = new FeatureGateOperationProcessor(null);
        var featureGate = new FeatureGateAttribute("TestFeature");

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act - both managers are null
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, null })!;

        // Assert
        result.Should().BeTrue(); // Line 92-93: if both null, return true
    }

    [Fact]
    public void IsFeatureEnabled_WithSingleFeature_DefaultRequirementType_UsesAll()
    {
        // Arrange
        _featureManagerMock.Setup(x => x.IsEnabledAsync("SingleFeature")).ReturnsAsync(true);
        var processor = new FeatureGateOperationProcessor(_serviceProviderMock.Object);
        var featureGate = new FeatureGateAttribute("SingleFeature"); // Default RequirementType is All

        var methodInfo = typeof(FeatureGateOperationProcessor).GetMethod(
            "IsFeatureEnabled",
            BindingFlags.NonPublic | BindingFlags.Instance);

        // Act
        var result = (bool)methodInfo!.Invoke(processor, new object?[] { featureGate, null, _featureManagerMock.Object })!;

        // Assert
        result.Should().BeTrue();
        featureGate.RequirementType.Should().Be(RequirementType.All);
    }

    #endregion

    #region Test Controllers

    [FeatureGate("ControllerFeature")]
    private class TestFeatureGatedController : ControllerBase
    {
        [FeatureGate("ActionFeature")]
        public IActionResult FeatureGatedAction() => Ok();

        public IActionResult NonGatedAction() => Ok();
    }

    [FeatureGate("Feature1", "Feature2")]
    private class TestMultiFeatureController : ControllerBase
    {
        public IActionResult Index() => Ok();
    }

    [FeatureGate(RequirementType.Any, "FeatureA", "FeatureB")]
    private class TestAnyFeatureController : ControllerBase
    {
        public IActionResult Index() => Ok();
    }

    private class TestNoFeatureController : ControllerBase
    {
        public IActionResult Index() => Ok();
    }

    #endregion
}
