using FluentAssertions;
using Moq;
using Toggly.FeatureManagement;
using Toggly.FeatureManagement.HangfireExtensions;
using Xunit;

namespace Toggly.FeatureManagement.Hangfire.Tests;

public class HangfireExtensionsTests
{
    private readonly Mock<IFeatureStateService> _featureStateServiceMock;

    public HangfireExtensionsTests()
    {
        _featureStateServiceMock = new Mock<IFeatureStateService>();
        _featureStateServiceMock
            .Setup(x => x.WhenFeatureTurnsOn(It.IsAny<object>(), It.IsAny<Action>()))
            .Returns(Guid.NewGuid());
        _featureStateServiceMock
            .Setup(x => x.WhenFeatureTurnsOff(It.IsAny<object>(), It.IsAny<Action>()))
            .Returns(Guid.NewGuid());
    }

    private enum TestFeatures
    {
        FeatureA,
        FeatureB
    }

    #region Argument Validation Tests

    [Fact]
    public void AddOrUpdateJob_WithStringFeatureKey_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            "feature-key",
            () => Console.WriteLine("test"),
            "*/5 * * * *");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_WithEnumFeatureKey_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            TestFeatures.FeatureA,
            () => Console.WriteLine("test"),
            "*/5 * * * *");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_WithIntegerFeatureKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            123,
            () => Console.WriteLine("test"),
            "*/5 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    [Fact]
    public void AddOrUpdateJob_WithObjectFeatureKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            new object(),
            () => Console.WriteLine("test"),
            "*/5 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    [Fact]
    public void AddOrUpdateJob_WithBoolFeatureKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            true,
            () => Console.WriteLine("test"),
            "*/5 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    #endregion

    #region Callback Registration Tests (Action overloads)

    [Fact]
    public void AddOrUpdateJob_WithStringCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "my-feature",
            () => Console.WriteLine("job"),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("my-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("my-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_WithFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "my-feature",
            () => Console.WriteLine("job"),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("my-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("my-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_WithEnumKey_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            TestFeatures.FeatureB,
            () => Console.WriteLine("job"),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals(TestFeatures.FeatureB)), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals(TestFeatures.FeatureB)), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_WithRecurringJobId_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "my-feature",
            "custom-job-id",
            () => Console.WriteLine("job"),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("my-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("my-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    #endregion

    #region Callback Registration Tests (Func<Task> overloads)

    [Fact]
    public void AddOrUpdateJob_AsyncWithStringCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "async-feature",
            () => Task.CompletedTask,
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("async-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("async-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_AsyncWithFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "async-feature",
            () => Task.CompletedTask,
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("async-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("async-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_AsyncWithRecurringJobId_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "async-feature",
            "async-job-id",
            () => Task.CompletedTask,
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("async-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("async-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    #endregion

    #region Generic Overload Tests

    [Fact]
    public void AddOrUpdateJob_Generic_WithStringFeatureKey_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature-key",
            svc => svc.DoWork(),
            "*/5 * * * *");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_Generic_WithInvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            12345L,
            svc => svc.DoWork(),
            "*/5 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    [Fact]
    public void AddOrUpdateJob_Generic_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-feature",
            svc => svc.DoWork(),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsync_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-async-feature",
            svc => svc.DoWorkAsync(),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-async-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-async-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericWithJobId_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-feature",
            "custom-id",
            svc => svc.DoWork(),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobId_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-async-feature",
            "async-custom-id",
            svc => svc.DoWorkAsync(),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-async-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-async-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    #endregion

    #region TimeZone and Queue Parameter Tests

    [Fact]
    public void AddOrUpdateJob_WithTimeZone_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            "feature",
            () => Console.WriteLine("test"),
            "0 * * * *",
            TimeZoneInfo.Utc);

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_WithCustomQueue_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            "feature",
            () => Console.WriteLine("test"),
            "0 * * * *",
            queue: "critical");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_WithAllOptionalParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            "feature",
            "job-id",
            () => Console.WriteLine("test"),
            "0 * * * *",
            TimeZoneInfo.Local,
            "priority-queue");

        // Assert
        act.Should().NotThrow();
    }

    #endregion

    // Test service class for generic overload tests
    public class TestService
    {
        public void DoWork() { }
        public Task DoWorkAsync() => Task.CompletedTask;
    }
}
