CREATE TABLE "TogglyCatalogs" (
    "Id" VARCHAR(64) PRIMARY KEY,
    "CatalogName" VARCHAR(256) NOT NULL,
    "Revision" VARCHAR(36) NOT NULL,
    "Payload" TEXT NOT NULL,
    "UpdatedAtUtc" TIMESTAMPTZ NOT NULL
);
