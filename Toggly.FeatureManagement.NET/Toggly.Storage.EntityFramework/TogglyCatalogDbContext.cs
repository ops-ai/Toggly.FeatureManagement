using Microsoft.EntityFrameworkCore;

namespace Toggly.FeatureManagement.Storage.EntityFramework
{
    /// <summary>
    /// Dedicated Entity Framework context for editable embedded feature catalogs.
    /// </summary>
    public sealed class TogglyCatalogDbContext : DbContext
    {
        /// <summary>
        /// Initializes the catalog context.
        /// </summary>
        public TogglyCatalogDbContext(DbContextOptions<TogglyCatalogDbContext> options)
            : base(options)
        {
        }

        /// <summary>
        /// Authoritative embedded feature catalogs.
        /// </summary>
        public DbSet<CatalogEntity> TogglyCatalogs { get; set; } = null!;

        /// <inheritdoc />
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<CatalogEntity>(entity =>
            {
                entity.ToTable("TogglyCatalogs");
                entity.HasKey(catalog => catalog.Id);
                entity.Property(catalog => catalog.Id).HasMaxLength(64);
                entity.Property(catalog => catalog.CatalogName).HasMaxLength(256).IsRequired();
                entity.Property(catalog => catalog.Revision).HasMaxLength(36).IsRequired().IsConcurrencyToken();
                entity.Property(catalog => catalog.Payload).IsRequired();
                entity.Property(catalog => catalog.UpdatedAtUtc).IsRequired();
            });
        }
    }

    /// <summary>
    /// Database envelope for one catalog. The payload stays portable while identity and concurrency remain storage-specific.
    /// </summary>
    public sealed class CatalogEntity
    {
        /// <summary>
        /// SHA-256 hex digest of the UTF-8 catalog name.
        /// </summary>
        public string Id { get; set; } = string.Empty;

        /// <summary>
        /// Original logical catalog name.
        /// </summary>
        public string CatalogName { get; set; } = string.Empty;

        /// <summary>
        /// Application-managed optimistic concurrency token.
        /// </summary>
        public string Revision { get; set; } = string.Empty;

        /// <summary>
        /// Canonical portable catalog JSON.
        /// </summary>
        public string Payload { get; set; } = string.Empty;

        /// <summary>
        /// Time of the successful write in UTC.
        /// </summary>
        public DateTimeOffset UpdatedAtUtc { get; set; }
    }
}
