# Toggly DistributedCache storage

This package stores cloud snapshots and authoritative offline embedded catalogs through the host application's `IDistributedCache`.

## Embedded catalog setup

Choose the access mode explicitly. Reader instances can refresh and evaluate an existing catalog, but reject all mutations. Configure exactly one `SingleWriter` process for a catalog; its process-local gate serializes read/check/write operations. The gate does not coordinate writers across processes or hosts.

```csharp
builder.Services.AddTogglyDistributedCacheCatalogStore(options =>
{
    options.AccessMode = CatalogCacheAccessMode.SingleWriter;
});
```

Catalogs use the isolated key `Toggly:Catalogs:{sha256-of-catalog-name}`. Toggly does not set a cache expiration; the chosen backend owns durability and eviction. If a cache entry is evicted, readers keep their in-memory embedded snapshot and never repopulate it automatically.

Use `Reader` mode for every replica other than the designated writer:

```csharp
builder.Services.AddTogglyDistributedCacheCatalogStore(options =>
{
    options.AccessMode = CatalogCacheAccessMode.Reader;
});
```
