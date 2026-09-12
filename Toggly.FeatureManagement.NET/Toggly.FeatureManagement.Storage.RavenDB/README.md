# Toggly RavenDB storage

`Toggly.FeatureManagement.Storage.RavenDB` stores embedded feature catalogs in the host application's RavenDB database.

Register the host-owned `IDocumentStore`, then add the catalog store:

```csharp
builder.Services.AddSingleton(documentStore);
builder.Services.AddTogglyRavenDbCatalogStore();
```

Catalogs use document IDs in the form `TogglyCatalogs/{sha256-of-catalog-name}`. Each operation opens and disposes an asynchronous RavenDB session. Conditional writes use both opaque catalog revisions and RavenDB optimistic concurrency; a competing create or update returns a catalog conflict without overwriting the committed document.

This is distinct from the existing snapshot provider, which stores cloud last-known-good definitions under `FeatureSnapshots/*` and is not an editable catalog.
