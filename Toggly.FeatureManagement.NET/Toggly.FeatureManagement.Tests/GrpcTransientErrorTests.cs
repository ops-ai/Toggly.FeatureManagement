using FluentAssertions;
using Grpc.Core;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class GrpcTransientErrorTests
{
    [Theory]
    [InlineData(StatusCode.DeadlineExceeded, false, true)]
    [InlineData(StatusCode.Unavailable, false, true)]
    [InlineData(StatusCode.ResourceExhausted, false, true)]
    [InlineData(StatusCode.Cancelled, false, true)]
    [InlineData(StatusCode.Cancelled, true, false)]
    [InlineData(StatusCode.Internal, false, false)]
    [InlineData(StatusCode.PermissionDenied, false, false)]
    [InlineData(StatusCode.Unauthenticated, false, false)]
    public void IsTransient_ClassifiesStatusCodes(StatusCode statusCode, bool shuttingDown, bool expected)
    {
        var exception = new RpcException(new Status(statusCode, statusCode.ToString()));

        GrpcTransientError.IsTransient(exception, shuttingDown).Should().Be(expected);
    }

    [Theory]
    [InlineData(1, 1)]
    [InlineData(2, 2)]
    [InlineData(3, 4)]
    [InlineData(4, 8)]
    [InlineData(5, 16)]
    [InlineData(6, 30)]
    [InlineData(10, 30)]
    public void GetBackoffDelay_GrowsExponentiallyAndCaps(int failures, int expectedMinutes)
    {
        GrpcTransientError.GetBackoffDelay(failures).Should().Be(TimeSpan.FromMinutes(expectedMinutes));
    }

    [Fact]
    public void WarningLogInterval_IsLongerThanAndIndependentOfEarlyBackoffDelays()
    {
        // The retry timer uses GetBackoffDelay; if the log window matched that delay,
        // every timer tick would re-emit Warning. The log interval must stay longer
        // than early backoff steps and not be derived from the current delay.
        GrpcTransientError.WarningLogInterval.Should().Be(TimeSpan.FromMinutes(5));
        GrpcTransientError.WarningLogInterval.Should().BeGreaterThan(GrpcTransientError.GetBackoffDelay(1));
        GrpcTransientError.WarningLogInterval.Should().BeGreaterThan(GrpcTransientError.GetBackoffDelay(2));
        GrpcTransientError.WarningLogInterval.Should().BeGreaterThan(GrpcTransientError.GetBackoffDelay(3));
        GrpcTransientError.WarningLogInterval.Should().NotBe(GrpcTransientError.GetBackoffDelay(4));
        GrpcTransientError.WarningLogInterval.Should().NotBe(GrpcTransientError.GetBackoffDelay(5));
        GrpcTransientError.WarningLogInterval.Should().NotBe(GrpcTransientError.GetBackoffDelay(6));
    }

    [Fact]
    public void BackoffState_LogsFirstFailureThenSuppressesUntilWindowElapses()
    {
        var state = new GrpcTransientError.BackoffState();

        var first = state.RecordFailure();
        first.ShouldLog.Should().BeTrue();
        first.Delay.Should().Be(TimeSpan.FromMinutes(1));

        // Immediate subsequent failures must be suppressed even though backoff is only 1–2 minutes;
        // the log window is WarningLogInterval (5m), independent of Delay.
        var second = state.RecordFailure();
        second.ShouldLog.Should().BeFalse();
        second.Delay.Should().Be(TimeSpan.FromMinutes(2));

        var third = state.RecordFailure();
        third.ShouldLog.Should().BeFalse();
        third.Delay.Should().Be(TimeSpan.FromMinutes(4));

        state.Reset();
        var afterReset = state.RecordFailure();
        afterReset.ShouldLog.Should().BeTrue();
        state.ConsecutiveFailures.Should().Be(1);
    }
}
