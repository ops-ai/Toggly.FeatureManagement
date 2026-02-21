using FluentAssertions;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class TogglyFeatureStateServiceTests
{
    private readonly TogglyFeatureStateService _service;

    public TogglyFeatureStateServiceTests()
    {
        _service = new TogglyFeatureStateService();
    }

    #region WhenFeatureTurnsOn Tests

    [Fact]
    public void WhenFeatureTurnsOn_WithStringKey_RegistersCallback()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callbackFired = false;

        // Act
        var id = _service.WhenFeatureTurnsOn(featureKey, () => callbackFired = true);

        // Assert
        id.Should().NotBeEmpty();
        callbackFired.Should().BeFalse(); // Not fired yet since state not set
    }

    [Fact]
    public void WhenFeatureTurnsOn_WithStringKey_CallbackFiresWhenFeatureTurnsOn()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callbackFired = false;
        _service.WhenFeatureTurnsOn(featureKey, () => callbackFired = true);

        // Act
        _service.UpdateFeatureState(featureKey, true);

        // Assert
        callbackFired.Should().BeTrue();
    }

    [Fact]
    public void WhenFeatureTurnsOn_WithEnumKey_ResolvesToCorrectString()
    {
        // Arrange
        var callbackFired = false;
        _service.WhenFeatureTurnsOn(TestFeature.MyFeature, () => callbackFired = true);

        // Act
        _service.UpdateFeatureState("MyFeature", true);

        // Assert
        callbackFired.Should().BeTrue();
    }

    [Fact]
    public void WhenFeatureTurnsOn_WithInvalidKeyType_ThrowsArgumentException()
    {
        // Arrange
        var invalidKey = 123; // int is not valid

        // Act & Assert
        var act = () => _service.WhenFeatureTurnsOn(invalidKey, () => { });
        act.Should().Throw<ArgumentException>()
            .WithMessage("*enum or string*");
    }

    [Fact]
    public void WhenFeatureTurnsOn_FiresImmediately_IfFeatureAlreadyOn()
    {
        // Arrange
        const string featureKey = "test-feature";
        _service.UpdateFeatureState(featureKey, true);
        var callbackFired = false;

        // Act
        _service.WhenFeatureTurnsOn(featureKey, () => callbackFired = true);

        // Assert
        callbackFired.Should().BeTrue();
    }

    #endregion

    #region WhenFeatureTurnsOff Tests

    [Fact]
    public void WhenFeatureTurnsOff_CallbackFiresWhenFeatureTurnsOff()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callbackFired = false;
        _service.UpdateFeatureState(featureKey, true); // Start with feature on
        _service.WhenFeatureTurnsOff(featureKey, () => callbackFired = true);

        // Act
        _service.UpdateFeatureState(featureKey, false);

        // Assert
        callbackFired.Should().BeTrue();
    }

    [Fact]
    public void WhenFeatureTurnsOff_FiresImmediately_IfFeatureAlreadyOff()
    {
        // Arrange
        const string featureKey = "test-feature";
        _service.UpdateFeatureState(featureKey, false);
        var callbackFired = false;

        // Act
        _service.WhenFeatureTurnsOff(featureKey, () => callbackFired = true);

        // Assert
        callbackFired.Should().BeTrue();
    }

    [Fact]
    public void WhenFeatureTurnsOff_WithEnumKey_ThrowsForInvalidType()
    {
        // Arrange
        var invalidKey = 123.45; // double is not valid

        // Act & Assert
        var act = () => _service.WhenFeatureTurnsOff(invalidKey, () => { });
        act.Should().Throw<ArgumentException>();
    }

    #endregion

    #region UpdateFeatureState Tests

    [Fact]
    public void UpdateFeatureState_DoesNothing_WhenStateUnchanged()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callCount = 0;
        _service.UpdateFeatureState(featureKey, true);
        _service.WhenFeatureTurnsOn(featureKey, () => callCount++);

        // Reset the count (WhenFeatureTurnsOn fires immediately if already on)
        callCount = 0;

        // Act
        _service.UpdateFeatureState(featureKey, true); // Same state

        // Assert
        callCount.Should().Be(0);
    }

    [Fact]
    public void UpdateFeatureState_NotifiesMultipleSubscribers()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callback1Fired = false;
        var callback2Fired = false;
        _service.WhenFeatureTurnsOn(featureKey, () => callback1Fired = true);
        _service.WhenFeatureTurnsOn(featureKey, () => callback2Fired = true);

        // Act
        _service.UpdateFeatureState(featureKey, true);

        // Assert
        callback1Fired.Should().BeTrue();
        callback2Fired.Should().BeTrue();
    }

    #endregion

    #region UnregisterFeatureStateChange Tests

    [Fact]
    public void UnregisterFeatureStateChange_RemovesOnSubscriber()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callbackFired = false;
        var id = _service.WhenFeatureTurnsOn(featureKey, () => callbackFired = true);

        // Act
        var result = _service.UnregisterFeatureStateChange(featureKey, id);
        _service.UpdateFeatureState(featureKey, true);

        // Assert
        result.Should().BeTrue();
        callbackFired.Should().BeFalse();
    }

    [Fact]
    public void UnregisterFeatureStateChange_RemovesOffSubscriber()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callbackFired = false;
        _service.UpdateFeatureState(featureKey, true); // Start with on
        var id = _service.WhenFeatureTurnsOff(featureKey, () => callbackFired = true);

        // Act
        var result = _service.UnregisterFeatureStateChange(featureKey, id);
        _service.UpdateFeatureState(featureKey, false);

        // Assert
        result.Should().BeTrue();
        callbackFired.Should().BeFalse();
    }

    [Fact]
    public void UnregisterFeatureStateChange_ReturnsFalse_ForUnknownKey()
    {
        // Act
        var result = _service.UnregisterFeatureStateChange("unknown-feature", Guid.NewGuid());

        // Assert
        result.Should().BeFalse();
    }

    #endregion

    #region WhenDefinitionsChange Tests

    [Fact]
    public void WhenDefinitionsChange_FiresOnNotifyDefinitionsChanged()
    {
        // Arrange
        var callbackFired = false;
        _service.WhenDefinitionsChange(() => callbackFired = true);

        // Act
        _service.NotifyDefinitionsChanged();

        // Assert
        callbackFired.Should().BeTrue();
    }

    [Fact]
    public void WhenDefinitionsChange_NotifiesMultipleSubscribers()
    {
        // Arrange
        var callback1Fired = false;
        var callback2Fired = false;
        _service.WhenDefinitionsChange(() => callback1Fired = true);
        _service.WhenDefinitionsChange(() => callback2Fired = true);

        // Act
        _service.NotifyDefinitionsChanged();

        // Assert
        callback1Fired.Should().BeTrue();
        callback2Fired.Should().BeTrue();
    }

    #endregion

    #region UnregisterDefinitionsChange Tests

    [Fact]
    public void UnregisterDefinitionsChange_StopsNotifications()
    {
        // Arrange
        var callbackFired = false;
        var id = _service.WhenDefinitionsChange(() => callbackFired = true);

        // Act
        var result = _service.UnregisterDefinitionsChange(id);
        _service.NotifyDefinitionsChanged();

        // Assert
        result.Should().BeTrue();
        callbackFired.Should().BeFalse();
    }

    [Fact]
    public void UnregisterDefinitionsChange_ReturnsFalse_ForUnknownId()
    {
        // Act
        var result = _service.UnregisterDefinitionsChange(Guid.NewGuid());

        // Assert
        result.Should().BeFalse();
    }

    #endregion

    #region NotifyDefinitionsChanged Tests

    [Fact]
    public void NotifyDefinitionsChanged_SwallowsSubscriberExceptions()
    {
        // Arrange
        var callback2Fired = false;
        _service.WhenDefinitionsChange(() => throw new InvalidOperationException("Test exception"));
        _service.WhenDefinitionsChange(() => callback2Fired = true);

        // Act - should not throw
        var act = () => _service.NotifyDefinitionsChanged();

        // Assert
        act.Should().NotThrow();
        callback2Fired.Should().BeTrue();
    }

    #endregion

    #region Thread Safety Tests

    [Fact]
    public async Task ConcurrentSubscribeUnsubscribe_IsThreadSafe()
    {
        // Arrange
        const string featureKey = "test-feature";
        var ids = new List<Guid>();
        var lockObj = new object();

        // Act - subscribe from multiple threads
        var tasks = Enumerable.Range(0, 100).Select(_ => Task.Run(() =>
        {
            var id = _service.WhenFeatureTurnsOn(featureKey, () => { });
            lock (lockObj)
            {
                ids.Add(id);
            }
        }));

        await Task.WhenAll(tasks);

        // Assert
        ids.Should().HaveCount(100);
        ids.Should().OnlyHaveUniqueItems();
    }

    [Fact]
    public async Task ConcurrentStateUpdates_IsThreadSafe()
    {
        // Arrange
        const string featureKey = "test-feature";
        var callCount = 0;
        _service.WhenFeatureTurnsOn(featureKey, () => Interlocked.Increment(ref callCount));
        _service.WhenFeatureTurnsOff(featureKey, () => Interlocked.Increment(ref callCount));

        // Act - update state from multiple threads
        var tasks = Enumerable.Range(0, 100).Select(i => Task.Run(() =>
        {
            _service.UpdateFeatureState(featureKey, i % 2 == 0);
        }));

        // Assert - should not throw
        var act = async () => await Task.WhenAll(tasks);
        await act.Should().NotThrowAsync();
    }

    #endregion

    private enum TestFeature
    {
        MyFeature,
        AnotherFeature
    }
}
