/**
 * Origin fetch helpers for gated `*.pages.dev` branch aliases.
 */
import type { Env } from './types';

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-encoding',
  'accept-language',
  'if-none-match',
  'if-modified-since',
  'cache-control',
  'range',
];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;

function isPagesDevHost(hostname: string): boolean {
  return hostname === 'pages.dev' || hostname.endsWith('.pages.dev');
}

function isAccessLoginUrl(url: URL): boolean {
  return (
    url.hostname.endsWith('.cloudflareaccess.com') ||
    url.pathname.startsWith('/cdn-cgi/access/')
  );
}

function isPublicHostname(hostname: string, env: Env): boolean {
  return !!env.WORKER_PUBLIC_HOST && hostname === env.WORKER_PUBLIC_HOST;
}

/** Normalise secret values pasted from the Access dashboard or wrangler. */
export function normalizeAccessCredential(value: string | undefined): string {
  if (!value) {
    return '';
  }

  let normalized = value.trim();

  // Allow pasting the full header line from the dashboard by mistake.
  const clientIdPrefix = 'CF-Access-Client-Id:';
  const clientSecretPrefix = 'CF-Access-Client-Secret:';
  if (normalized.startsWith(clientIdPrefix)) {
    normalized = normalized.slice(clientIdPrefix.length).trim();
  } else if (normalized.startsWith(clientSecretPrefix)) {
    normalized = normalized.slice(clientSecretPrefix.length).trim();
  }

  return normalized;
}

export function getAccessCredentials(env: Env): {
  clientId: string;
  clientSecret: string;
} {
  return {
    clientId: normalizeAccessCredential(env.CF_ACCESS_CLIENT_ID),
    clientSecret: normalizeAccessCredential(env.CF_ACCESS_CLIENT_SECRET),
  };
}

/** Response headers/body indicate Cloudflare Access intercepted the fetch. */
export function isAccessLoginResponse(response: Response): boolean {
  if (response.status === 401 || response.status === 403) {
    return true;
  }

  // Successful static assets should not carry Access login markers.
  if (response.ok && !response.headers.get('cf-access-domain')) {
    return false;
  }

  return !!response.headers.get('cf-access-domain');
}

export function originAccessDeniedResponse(env: Env): Response {
  const { clientId, clientSecret } = getAccessCredentials(env);
  const accessConfigured = !!(clientId && clientSecret);

  return new Response(
    [
      'Origin fetch blocked by Cloudflare Access.',
      '',
      accessConfigured
        ? 'Worker secrets are present but the origin rejected the service token.'
        : 'Worker is missing CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET.',
      '',
      'Verify with:',
      `curl -sI -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" ${env.ORIGIN_BASE_URL}/`,
      '',
      'Access policy must use Action: Service Auth (not Allow) with Include →',
      'Service Token → toggly-docusaurus-edge-worker. Allow policies ignore',
      'CF-Access-Client-Id/Secret headers — that is why Last Seen stays empty.',
    ].join('\n'),
    {
      status: 502,
      headers: {
        'Content-Type': 'text/plain',
        'X-Toggly-Access-Configured': accessConfigured ? 'true' : 'false',
      },
    },
  );
}

/**
 * Build headers for an origin fetch.
 */
export function buildOriginHeaders(
  env: Env,
  incomingHeaders?: HeadersInit,
): Headers {
  const headers = new Headers();
  const incoming = new Headers(incomingHeaders ?? undefined);

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  const { clientId, clientSecret } = getAccessCredentials(env);
  if (clientId && clientSecret) {
    headers.set('CF-Access-Client-Id', clientId);
    headers.set('CF-Access-Client-Secret', clientSecret);
  }

  return headers;
}

function finalizeOriginResponse(response: Response, env: Env): Response {
  if (isAccessLoginResponse(response)) {
    console.error('Origin returned Cloudflare Access login instead of content');
    return originAccessDeniedResponse(env);
  }
  return response;
}

/**
 * Fetch a URL on the origin with Access headers and safe redirect handling.
 */
export async function fetchFromOrigin(
  url: string,
  init: RequestInit & { headers?: HeadersInit } = {},
  env: Env,
): Promise<Response> {
  let currentUrl = new URL(url);
  let method = init.method ?? 'GET';
  let redirectCount = 0;

  while (redirectCount <= MAX_REDIRECTS) {
    const headers = buildOriginHeaders(env, init.headers);
    const response = await fetch(currentUrl.toString(), {
      ...init,
      method,
      headers,
      redirect: 'manual',
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return finalizeOriginResponse(response, env);
    }

    const location = response.headers.get('Location');
    if (!location) {
      return finalizeOriginResponse(response, env);
    }

    const nextUrl = new URL(location, currentUrl);

    if (isPublicHostname(nextUrl.hostname, env)) {
      currentUrl = new URL(
        nextUrl.pathname + nextUrl.search,
        env.ORIGIN_BASE_URL,
      );
      method = 'GET';
      redirectCount++;
      continue;
    }

    if (isAccessLoginUrl(nextUrl)) {
      console.error(
        `Origin Access login redirect during fetch (${currentUrl.hostname})`,
      );
      return originAccessDeniedResponse(env);
    }

    if (!isPagesDevHost(nextUrl.hostname)) {
      console.warn(
        `Unexpected origin redirect to ${nextUrl.hostname}; refusing to forward`,
      );
      return originAccessDeniedResponse(env);
    }

    currentUrl = nextUrl;
    method = 'GET';
    redirectCount++;
  }

  return new Response('Origin redirect loop', { status: 502 });
}

/** Lightweight probe used by `/__toggly_origin_probe` for ops debugging. */
export async function probeOriginAccess(env: Env): Promise<Response> {
  const { clientId, clientSecret } = getAccessCredentials(env);
  const probeUrl = new URL('/', env.ORIGIN_BASE_URL).toString();
  const headers = buildOriginHeaders(env);

  const response = await fetch(probeUrl, {
    method: 'GET',
    headers,
    redirect: 'manual',
  });

  return Response.json({
    originBaseUrl: env.ORIGIN_BASE_URL,
    workerPublicHost: env.WORKER_PUBLIC_HOST ?? null,
    accessConfigured: !!(clientId && clientSecret),
    clientIdSuffix: clientId ? clientId.slice(-16) : null,
    originStatus: response.status,
    originLocation: response.headers.get('location'),
    originCfAccessDomain: response.headers.get('cf-access-domain'),
  });
}
