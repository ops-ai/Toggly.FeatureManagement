/**
 * Build ambient IdentityContext / EvalContext from a Remix Request.
 */

import {
  fromHttpRequest,
  parseIdentity,
  HEADERS,
  STORAGE_KEYS,
  type IdentityContext,
} from '@ops-ai/remix-toggly-core';

/**
 * Providers that build ambient EvalContext for a Remix request.
 */
export interface EvalContextProviders {
  /** Extract identity from the request */
  getIdentity?: (
    request: Request,
  ) => string | undefined | Promise<string | undefined>;
  /** Extract identity from cookies (fallback when getIdentity is unset) */
  getIdentityFromCookies?: (cookies: string | null) => string | undefined;
  /** Extract group memberships for Targeting / Percentage filters */
  getGroups?: (
    request: Request,
  ) => string[] | undefined | Promise<string[] | undefined>;
  /** Extract principal / JWT-style claims for UserClaims filters */
  getClaims?: (
    request: Request,
  ) =>
    | Record<string, string>
    | undefined
    | Promise<Record<string, string> | undefined>;
  /**
   * Full ambient context. When provided, returned fields are used;
   * missing `request` keys are still filled from headers via `fromHttpRequest`.
   */
  getContext?: (
    request: Request,
  ) => IdentityContext | Promise<IdentityContext>;
}

function headersToBag(
  headers: Headers,
): Record<string, string | string[] | undefined> {
  const bag: Record<string, string | string[] | undefined> = {};
  headers.forEach((value, key) => {
    bag[key] = value;
  });
  return bag;
}

function getIdentityFromRequest(
  request: Request,
  customCookieParser?: (cookies: string | null) => string | undefined,
): string | undefined {
  const headerIdentity = request.headers.get(HEADERS.IDENTITY);
  if (headerIdentity) {
    return parseIdentity(headerIdentity);
  }

  const cookies = request.headers.get('cookie');

  if (customCookieParser) {
    return customCookieParser(cookies);
  }

  if (cookies) {
    const identity = parseCookie(cookies, STORAGE_KEYS.IDENTITY);
    if (identity) {
      return parseIdentity(identity);
    }
  }

  return undefined;
}

function parseCookie(cookies: string, name: string): string | undefined {
  const pairs = cookies.split(';');

  for (const pair of pairs) {
    const [key, value] = pair.trim().split('=');
    if (key === name && value) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * Resolve ambient IdentityContext for a Remix Request.
 * Uses `getContext` when provided; otherwise getIdentity / getGroups / getClaims.
 * Always fills missing `request` fields from headers via `fromHttpRequest`.
 * UserClaims must be supplied via `claims` (not `traits`).
 */
export async function extractEvalContext(
  request: Request,
  providers: EvalContextProviders = {},
): Promise<IdentityContext> {
  const headers = headersToBag(request.headers);
  const headerRequest = fromHttpRequest(headers).request;

  if (providers.getContext) {
    const custom = await providers.getContext(request);
    return {
      identity: custom.identity,
      groups: custom.groups,
      // Prefer claims for UserClaims; ignore traits-as-claims from custom
      claims: custom.claims,
      traits: custom.traits,
      request: {
        ...headerRequest,
        ...custom.request,
      },
    };
  }

  let identity: string | undefined;
  if (providers.getIdentity) {
    identity = await providers.getIdentity(request);
  } else {
    identity = getIdentityFromRequest(
      request,
      providers.getIdentityFromCookies,
    );
  }

  const groups = providers.getGroups
    ? await providers.getGroups(request)
    : undefined;
  const claims = providers.getClaims
    ? await providers.getClaims(request)
    : undefined;

  const fromReq = fromHttpRequest(headers, { identity, groups, claims });

  return {
    identity: fromReq.identity,
    groups: fromReq.groups,
    claims: fromReq.claims,
    request: fromReq.request,
  };
}

export { getIdentityFromRequest, parseCookie };
