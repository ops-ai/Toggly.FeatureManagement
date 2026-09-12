using Microsoft.Extensions.Options;
using System;

namespace Toggly.FeatureManagement.Storage.DistributedCache
{
    /// <summary>
    /// Controls how a distributed-cache catalog store may access an embedded catalog.
    /// </summary>
    public enum CatalogCacheAccessMode
    {
        /// <summary>
        /// Allows reads only. Dashboard mutations are rejected by the store.
        /// </summary>
        Reader,

        /// <summary>
        /// Allows one writer process to serialize conditional writes locally.
        /// </summary>
        SingleWriter
    }

    /// <summary>
    /// Configuration for an embedded catalog stored through <see cref="Microsoft.Extensions.Caching.Distributed.IDistributedCache"/>.
    /// </summary>
    public sealed class TogglyDistributedCacheCatalogOptions
    {
        /// <summary>
        /// Gets or sets the catalog access mode. The safe default is <see cref="CatalogCacheAccessMode.Reader"/>.
        /// </summary>
        public CatalogCacheAccessMode AccessMode { get; set; } = CatalogCacheAccessMode.Reader;
    }

    internal sealed class TogglyDistributedCacheCatalogOptionsValidator : IValidateOptions<TogglyDistributedCacheCatalogOptions>
    {
        public ValidateOptionsResult Validate(string? name, TogglyDistributedCacheCatalogOptions options)
        {
            if (options == null) return ValidateOptionsResult.Fail("Toggly distributed-cache catalog options are required.");
            if (!Enum.IsDefined(typeof(CatalogCacheAccessMode), options.AccessMode))
            {
                return ValidateOptionsResult.Fail("Toggly distributed-cache catalog AccessMode is invalid.");
            }

            return ValidateOptionsResult.Success;
        }
    }
}
