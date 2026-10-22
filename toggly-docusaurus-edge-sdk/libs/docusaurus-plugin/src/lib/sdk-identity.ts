import { buildDefinitionFetchHeaders as buildCoreDefinitionFetchHeaders } from '@ops-ai/toggly-client-core';

export const SDK_ID = 'docusaurus';
export const SDK_VERSION = '0.10.4';

const SDK = { id: SDK_ID, version: SDK_VERSION };

export function buildDefinitionFetchHeaders(
  existing: Record<string, string> = {},
): Record<string, string> {
  return buildCoreDefinitionFetchHeaders(existing, SDK);
}
