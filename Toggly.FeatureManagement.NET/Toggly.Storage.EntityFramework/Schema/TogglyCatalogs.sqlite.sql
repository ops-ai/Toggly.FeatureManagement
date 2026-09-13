CREATE TABLE "TogglyCatalogs" (
    "Id" TEXT NOT NULL PRIMARY KEY,
    "CatalogName" TEXT NOT NULL,
    "Revision" TEXT NOT NULL,
    "Payload" TEXT NOT NULL,
    "UpdatedAtUtc" TEXT NOT NULL
);
