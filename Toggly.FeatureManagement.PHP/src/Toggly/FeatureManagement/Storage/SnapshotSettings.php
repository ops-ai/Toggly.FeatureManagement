<?php

namespace Toggly\FeatureManagement\Storage;

/**
 * Settings for snapshot providers
 */
class SnapshotSettings
{
    /**
     * Document/entry name for feature snapshots
     */
    public ?string $documentName = null;

    /**
     * Document/entry name for JWK snapshots
     */
    public ?string $jwkDocumentName = null;

    public function __construct(array $config = [])
    {
        if (isset($config['document_name'])) {
            $this->documentName = $config['document_name'];
        }
        if (isset($config['jwk_document_name'])) {
            $this->jwkDocumentName = $config['jwk_document_name'];
        }
    }
}
