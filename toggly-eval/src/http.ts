import type { EvalContext } from './types'

/** Minimal header bag (Express / Fetch / IncomingMessage compatible). */
export type HttpHeaderBag = {
  get?(name: string): string | null | undefined
  [key: string]: string | string[] | undefined | ((name: string) => string | null | undefined)
}

function headerValue(
  headers: HttpHeaderBag | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase()
  if (typeof (headers as HttpHeaderBag).get === 'function') {
    const v = (headers as HttpHeaderBag).get!(lower) ?? (headers as HttpHeaderBag).get!(name)
    return typeof v === 'string' && v.length > 0 ? v : undefined
  }
  const rec = headers as Record<string, string | string[] | undefined>
  const raw = rec[lower] ?? rec[name]
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
  headers: HttpHeaderBag | Record<string, string | string[] | undefined>,
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
