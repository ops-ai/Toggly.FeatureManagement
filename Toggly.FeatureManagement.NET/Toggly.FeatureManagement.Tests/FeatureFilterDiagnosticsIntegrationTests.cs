using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.FeatureManagement;
using Moq;
using Toggly.FeatureManagement.Filters;
using Xunit;

namespace Toggly.FeatureManagement.Tests;

public class FeatureFilterDiagnosticsIntegrationTests
{
    [Fact]
    public async Task WarnForMissingFiltersOnFeatureAsync_LogsOncePerMissingName()
    {
        var listener = new LogCaptureListener();
        var loggerFactory = LoggerFactory.Create(b =>
        {
            b.AddProvider(listener);
            b.SetMinimumLevel(LogLevel.Warning);
        });

        var registrationIndex = new FeatureFilterRegistrationIndex(new[] { "AlwaysOn" });
        var tracker = new MissingFeatureFilterWarningTracker(
            loggerFactory.CreateLogger<MissingFeatureFilterWarningTracker>());

        var definitionProvider = new Mock<IFeatureDefinitionProvider>();
        definitionProvider
            .Setup(p => p.GetFeatureDefinitionAsync("flag"))
            .ReturnsAsync(new FeatureDefinition
            {
                Name = "flag",
                EnabledFor = new[]
                {
                    new FeatureFilterConfiguration { Name = "Country" }
                }
            });

        var diagnostics = new FeatureFilterDiagnostics(
            definitionProvider.Object,
            registrationIndex,
            tracker);

        await diagnostics.WarnForMissingFiltersOnFeatureAsync("flag");
        await diagnostics.WarnForMissingFiltersOnFeatureAsync("flag");

        listener.Entries.Count(e =>
                e.Level == LogLevel.Warning && e.Message.Contains("CountryFamily", StringComparison.Ordinal))
            .Should().Be(1);
    }

    private sealed class LogCaptureListener : ILoggerProvider
    {
        public List<LogEntry> Entries { get; } = new();

        public ILogger CreateLogger(string categoryName) => new CaptureLogger(Entries);

        public void Dispose() { }
    }

    private sealed record LogEntry(LogLevel Level, string Message);

    private sealed class CaptureLogger : ILogger
    {
        private readonly List<LogEntry> _entries;

        public CaptureLogger(List<LogEntry> entries) => _entries = entries;

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            _entries.Add(new LogEntry(logLevel, formatter(state, exception)));

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}
