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


    [Table("ToggleFeatureFilters")]
    public partial class FeatureFilter
    {
        [Key]
        [StringLength(100)]
        public string Name { get; set; }

        [StringLength(8000)]
        public string Parameters { get; set; }

        public virtual Feature Feature { get; set; }
    }
}
