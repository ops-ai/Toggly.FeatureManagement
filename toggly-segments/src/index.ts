export interface SegmentSummary {
  id: string
  name: string
  environment?: string | null
  itemCount: number
}

export interface SegmentMember {
  identifier: string
  description?: string | null
}

export interface SegmentItemsPage {
  items: SegmentMember[]
  skip: number
  take: number
  total: number
}

export interface SegmentMembershipClientOptions {
  appKey: string
  baseUrl?: string
  fetch?: typeof fetch
}

export class SegmentMembershipError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SegmentMembershipError'
  }
}

export function createSegmentMembershipClient(options: SegmentMembershipClientOptions) {
  const baseUrl = (options.baseUrl ?? 'https://app.toggly.io').replace(/\/+$/, '')
  const http = options.fetch ?? fetch

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const requestHeaders: Record<string, string> = {
      Authorization: options.appKey,
      Accept: 'application/json',
    }
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json'
    }
    const response = await http(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new SegmentMembershipError(`Segment membership ${method} ${path} failed`, response.status)
    }
    if (response.status === 204) {
      return undefined as T
    }
    const text = await response.text()
    if (!text.trim()) {
      return undefined as T
    }
    return JSON.parse(text) as T
  }

  return {
    listSegments() {
      return request<SegmentSummary[]>('GET', '/api/v2/segments')
    },
    listItems(segment: string, skip = 0, take = 100) {
      const params = new URLSearchParams({ skip: String(skip), take: String(take) })
      return request<SegmentItemsPage>('GET', `/api/v2/segments/${encodeURIComponent(segment)}/items?${params}`)
    },
    addSegmentMembers(segment: string, identifiers: string[]) {
      return request<SegmentSummary>('POST', `/api/v2/segments/${encodeURIComponent(segment)}/items`, { identifiers })
    },
    removeSegmentMembers(segment: string, identifiers: string[]) {
      return request<SegmentSummary>('DELETE', `/api/v2/segments/${encodeURIComponent(segment)}/items`, { identifiers })
    },
    replaceSegmentMembers(segment: string, identifiers: string[]) {
      return request<SegmentSummary>('PUT', `/api/v2/segments/${encodeURIComponent(segment)}/items`, { identifiers })
    },
  }
}

export type SegmentMembershipClient = ReturnType<typeof createSegmentMembershipClient>
