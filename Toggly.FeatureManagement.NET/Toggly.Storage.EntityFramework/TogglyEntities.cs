using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Toggly.FeatureManagement.Storage.EntityFramework
{
    /// <summary>
    /// Entity Framework DbContext for Toggly snapshots
    /// </summary>
    public class TogglyEntities : DbContext
    {
        /// <summary>
        /// Constructor
        /// </summary>
        /// <param name="options"></param>
        public TogglyEntities(DbContextOptions<TogglyEntities> options) : base(options)
        {
        }

        /// <summary>
        /// Snapshot table
        /// </summary>
        public virtual DbSet<SnapshotEntity> TogglySnapshots { get; set; } = null!;

        /// <summary>
        /// Configure the model
        /// </summary>
        /// <param name="modelBuilder"></param>
        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<SnapshotEntity>(entity =>
            {
                entity.ToTable("TogglySnapshots");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.Id).HasMaxLength(100);
                entity.Property(e => e.Data).IsRequired();
                entity.Property(e => e.Signature).HasMaxLength(1000);
                entity.Property(e => e.KeyId).HasMaxLength(100);
                entity.Property(e => e.ETag).HasMaxLength(255);
            });
        }
    }

    /// <summary>
    /// Snapshot entity for storing feature and JWK snapshots
    /// </summary>
    [Table("TogglySnapshots")]
    public class SnapshotEntity
    {
        /// <summary>
        /// Unique identifier for the snapshot (e.g., "toggly_features" or "toggly_jwks")
        /// </summary>
        [Key]
        [StringLength(100)]
        public string Id { get; set; } = string.Empty;

        /// <summary>
        /// JSON serialized snapshot data
        /// </summary>
        [Required]
        public string Data { get; set; } = string.Empty;

        /// <summary>
        /// Signature for signed definitions (features only)
        /// </summary>
        [StringLength(1000)]
        public string? Signature { get; set; }

        /// <summary>
        /// Key ID for signature verification (features only)
        /// </summary>
        [StringLength(100)]
        public string? KeyId { get; set; }

        /// <summary>
        /// Timestamp of the snapshot
        /// </summary>
        public long? Timestamp { get; set; }

        /// <summary>
        /// Exact JSON text of the signed <c>defs</c> array from the server.
        /// </summary>
        public string? SignedDefsJson { get; set; }

        /// <summary>
        /// Definitions revision (ETag / X-Definitions-Revision) for conditional fetches.
        /// </summary>
        [StringLength(255)]
        public string? ETag { get; set; }

        /// <summary>
        /// Last update time
        /// </summary>
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
