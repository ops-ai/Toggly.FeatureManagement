using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace Toggly.FeatureManagement.Storage.EntityFramework
{
    public partial class TogglyEntities : DbContext
    {
        public TogglyEntities() : base()
        {
        }

        public virtual DbSet<Feature> TogglyFeatures { get; set; }
        
        public virtual DbSet<FeatureFilter> TogglyFeatureFilters { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Feature>()
                .HasMany(e => e.Filters)
                .WithOne(e => e.Feature)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<FeatureFilter>()
                .HasMany(e => e.Parameters)
                .WithOne(e => e.Filter)
                .OnDelete(DeleteBehavior.Cascade);
        }
    }

    [Table("TogglyFeatures")]
    public partial class Feature
    {
        [Key]
        [StringLength(100)]
        public string FeatureKey { get; set; }

        public virtual ICollection<FeatureFilter> Filters { get; set; }
    }

    [Table("TogglyFeatureFilters")]
    public partial class FeatureFilter
    {
        [Key]
        [StringLength(100)]
        public string Name { get; set; }

        public virtual Feature Feature { get; set; }

        public virtual ICollection<FeatureFilterParameter> Parameters { get; set; }
    }

    [Table("TogglyFeatureFilterParameters")]
    public partial class FeatureFilterParameter
    {
        [Key]
        public long Id { get; set; }

        [StringLength(100)]
        public string Name { get; set; }

        [StringLength(1000)]
        public string Value { get; set; }

        public virtual FeatureFilter Filter { get; set; }
    }
}
