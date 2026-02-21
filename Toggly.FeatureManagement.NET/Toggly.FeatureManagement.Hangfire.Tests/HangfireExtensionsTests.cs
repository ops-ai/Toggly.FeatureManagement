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

    #region Generic Overload with Func<string> CronExpression Tests

    [Fact]
    public void AddOrUpdateJob_GenericWithFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-func-feature",
            svc => svc.DoWork(),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-func-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-func-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericWithFuncCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            12345,
            svc => svc.DoWork(),
            () => "0 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-async-func-feature",
            svc => svc.DoWorkAsync(),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-async-func-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-async-func-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithFuncCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            false,
            svc => svc.DoWorkAsync(),
            () => "0 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    #endregion

    #region Generic Overload with JobId and Func<string> CronExpression Tests

    [Fact]
    public void AddOrUpdateJob_GenericWithJobIdAndFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-jobid-func-feature",
            "my-job-id",
            svc => svc.DoWork(),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericWithJobIdAndFuncCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            3.14159,
            "my-job-id",
            svc => svc.DoWork(),
            () => "0 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobIdAndFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-async-jobid-func-feature",
            "async-job-id",
            svc => svc.DoWorkAsync(),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-async-jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-async-jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobIdAndFuncCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            DateTime.Now,
            "async-job-id",
            svc => svc.DoWorkAsync(),
            () => "0 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    #endregion

    #region Action Overload with JobId and Func<string> CronExpression Tests

    [Fact]
    public void AddOrUpdateJob_WithJobIdAndFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "jobid-func-feature",
            "action-job-id",
            () => Console.WriteLine("job"),
            () => "0 * * * *",
            "featureName");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_WithJobIdAndFuncCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            new List<int>(),
            "action-job-id",
            () => Console.WriteLine("job"),
            () => "0 * * * *",
            "featureName");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    #endregion

    #region Async Overload with JobId and Func<string> CronExpression Tests

    [Fact]
    public void AddOrUpdateJob_AsyncWithJobIdAndFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            "async-jobid-func-feature",
            "async-action-job-id",
            () => Task.CompletedTask,
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("async-jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("async-jobid-func-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_AsyncWithJobIdAndFuncCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            new Dictionary<string, int>(),
            "async-action-job-id",
            () => Task.CompletedTask,
            () => "0 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    #endregion

    #region Generic Overload with JobId and String CronExpression Tests

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobIdAndStringCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "generic-async-jobid-string-feature",
            "string-cron-job-id",
            svc => svc.DoWorkAsync(),
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals("generic-async-jobid-string-feature")), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals("generic-async-jobid-string-feature")), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobIdAndStringCron_InvalidKey_ThrowsArgumentException()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            42.0m,
            "string-cron-job-id",
            svc => svc.DoWorkAsync(),
            "0 * * * *");

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    #endregion

    #region Enum Feature Key with Various Overloads Tests

    [Fact]
    public void AddOrUpdateJob_EnumWithFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            TestFeatures.FeatureA,
            () => Console.WriteLine("enum test"),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals(TestFeatures.FeatureA)), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals(TestFeatures.FeatureA)), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_EnumGenericWithStringCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            TestFeatures.FeatureB,
            svc => svc.DoWork(),
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
    public void AddOrUpdateJob_EnumAsyncWithJobId_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob(
            TestFeatures.FeatureA,
            "enum-async-job-id",
            () => Task.CompletedTask,
            "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals(TestFeatures.FeatureA)), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals(TestFeatures.FeatureA)), It.IsAny<Action>()),
            Times.Once);
    }

    [Fact]
    public void AddOrUpdateJob_EnumGenericAsyncWithFuncCron_RegistersBothCallbacks()
    {
        // Act
        _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            TestFeatures.FeatureB,
            svc => svc.DoWorkAsync(),
            () => "0 * * * *");

        // Assert
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOn(It.Is<object>(k => k.Equals(TestFeatures.FeatureB)), It.IsAny<Action>()),
            Times.Once);
        _featureStateServiceMock.Verify(
            x => x.WhenFeatureTurnsOff(It.Is<object>(k => k.Equals(TestFeatures.FeatureB)), It.IsAny<Action>()),
            Times.Once);
    }

    #endregion

    #region Full Optional Parameters Tests for Various Overloads

    [Fact]
    public void AddOrUpdateJob_GenericWithAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            svc => svc.DoWork(),
            "0 * * * *",
            TimeZoneInfo.Utc,
            "high-priority");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            svc => svc.DoWorkAsync(),
            "0 * * * *",
            TimeZoneInfo.Local,
            "low-priority");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericWithJobIdAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            "full-params-job-id",
            svc => svc.DoWork(),
            "0 * * * *",
            TimeZoneInfo.Utc,
            "critical");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobIdAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            "full-async-params-job-id",
            svc => svc.DoWorkAsync(),
            "0 * * * *",
            TimeZoneInfo.Local,
            "background");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_AsyncWithAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            "feature",
            () => Task.CompletedTask,
            "0 * * * *",
            TimeZoneInfo.Utc,
            "queue");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_AsyncWithJobIdAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob(
            "feature",
            "async-all-params-job-id",
            () => Task.CompletedTask,
            "0 * * * *",
            TimeZoneInfo.Local,
            "jobs");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericWithFuncCronAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            svc => svc.DoWork(),
            () => "0 * * * *",
            TimeZoneInfo.Utc,
            "queue");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithFuncCronAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            svc => svc.DoWorkAsync(),
            () => "0 * * * *",
            TimeZoneInfo.Local,
            "queue");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericWithJobIdFuncCronAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            "job-id",
            svc => svc.DoWork(),
            () => "0 * * * *",
            TimeZoneInfo.Utc,
            "queue");

        // Assert
        act.Should().NotThrow();
    }

    [Fact]
    public void AddOrUpdateJob_GenericAsyncWithJobIdFuncCronAndAllParameters_DoesNotThrow()
    {
        // Arrange & Act
        var act = () => _featureStateServiceMock.Object.AddOrUpdateJob<TestService>(
            "feature",
            "async-job-id",
            svc => svc.DoWorkAsync(),
            () => "0 * * * *",
            TimeZoneInfo.Local,
            "queue");

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
