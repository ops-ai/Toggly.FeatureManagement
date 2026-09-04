import type { EvalContext } from './types'

/** Fetch Headers / Map-like bags with a `get` method. */
export type HttpHeadersLike = {
  get(name: string): string | null | undefined
}

/**
 * Header bag accepted by `fromHttpRequest`.
 * Union avoids an index signature that conflicts with the Fetch `Headers` class.
 */
export type HttpHeaderBag =
  | HttpHeadersLike
  | Record<string, string | string[] | undefined>

function isHeadersLike(headers: HttpHeaderBag): headers is HttpHeadersLike {
  return typeof (headers as HttpHeadersLike).get === 'function'
}

function headerValue(headers: HttpHeaderBag, name: string): string | undefined {
  const lower = name.toLowerCase()
  if (isHeadersLike(headers)) {
    const v = headers.get(lower) ?? headers.get(name)
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const raw = headers[lower] ?? headers[name]
  if (Array.isArray(raw)) {
    return raw[0]
  }
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

/**
 * Map common HTTP request headers into EvalContext.request fields.
 * Does not set identity/groups/claims — merge those separately.
 */
export function fromHttpRequest(
  headers: HttpHeaderBag,
  extras: Omit<EvalContext, 'request'> = {},
): EvalContext {
  return {
    ...extras,
    request: {
      userAgent: headerValue(headers, 'user-agent'),
      acceptLanguage: headerValue(headers, 'accept-language'),
      country:
        headerValue(headers, 'cf-ipcountry') ??
        headerValue(headers, 'x-vercel-ip-country') ??
        headerValue(headers, 'cloudfront-viewer-country'),
    },
  }
}
