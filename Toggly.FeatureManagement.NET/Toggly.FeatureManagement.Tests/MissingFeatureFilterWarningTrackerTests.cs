using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class MissingFeatureFilterWarningTrackerTests
{
    [Fact]
    public void WarnIfMissing_LogsOncePerFilterName()
    {
        var logger = new Mock<ILogger<MissingFeatureFilterWarningTracker>>();
        var tracker = new MissingFeatureFilterWarningTracker(logger.Object);
        var index = new FeatureFilterRegistrationIndex(new[] { "AlwaysOn" });

        tracker.WarnIfMissing("DoesNotExist", index);
        tracker.WarnIfMissing("DoesNotExist", index);

        logger.Verify(
            x => x.Log(
                LogLevel.Warning,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((_, _) => true),
                It.IsAny<Exception>(),
                It.Is<Func<It.IsAnyType, Exception?, string>>((_, _) => true)),
            Times.Once);
    }

    [Fact]
    public void WarnIfMissing_DoesNotLog_WhenFilterIsRegistered()
    {
        var logger = new Mock<ILogger<MissingFeatureFilterWarningTracker>>();
        var tracker = new MissingFeatureFilterWarningTracker(logger.Object);
        var index = new FeatureFilterRegistrationIndex(new[] { "CountryFamily" });

        tracker.WarnIfMissing("CountryFamily", index);

        logger.VerifyNoOtherCalls();
    }
}
