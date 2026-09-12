using FluentAssertions;
using Toggly.FeatureManagement.Catalog;
using Xunit;

namespace Toggly.FeatureManagement.Catalog.Tests;

public sealed class CatalogStoreContractTests
{
    [Fact]
    public void Write_result_exposes_committed_snapshot_only_for_written_status()
    {
        var snapshot = new CatalogSnapshot
        {
            CatalogName = "Orders",
            Revision = "revision",
            UpdatedAtUtc = DateTimeOffset.Parse("2026-01-01T00:00:00+00:00"),
            Document = new CatalogDocument { SchemaVersion = 1, Environment = "Production", Features = [], Contexts = [] }
        };

        var written = CatalogWriteResult.Written(snapshot);
        var conflict = CatalogWriteResult.Conflict(snapshot);

        written.Status.Should().Be(CatalogWriteStatus.Written);
        written.Snapshot.Should().BeSameAs(snapshot);
        conflict.Status.Should().Be(CatalogWriteStatus.Conflict);
        conflict.Snapshot.Should().BeSameAs(snapshot);
    }
}
