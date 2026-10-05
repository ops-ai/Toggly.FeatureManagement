import { describe, expect, it, vi } from 'vitest'
import { createSegmentMembershipClient, SegmentMembershipError } from './index'

describe('createSegmentMembershipClient', () => {
  it('lists segments with a Backend key', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'abc', name: 'Beta Testers', itemCount: 1 }]), { status: 200 }),
    ) as unknown as typeof fetch
    const client = createSegmentMembershipClient({ appKey: 'backend-key', fetch: fetchMock })
    const segments = await client.listSegments()
    expect(segments[0].name).toBe('Beta Testers')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://app.toggly.io/api/v2/segments')
    expect((init.headers as Record<string, string>).Authorization).toBe('backend-key')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('returns undefined for empty success bodies', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 })) as unknown as typeof fetch
    const client = createSegmentMembershipClient({ appKey: 'backend-key', fetch: fetchMock })
    await expect(client.removeSegmentMembers('beta', ['u1'])).resolves.toBeUndefined()
  })

  it('throws on 403', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 403 })) as unknown as typeof fetch
    const client = createSegmentMembershipClient({ appKey: 'frontend-key', fetch: fetchMock })
    await expect(client.addSegmentMembers('beta', ['u1'])).rejects.toBeInstanceOf(SegmentMembershipError)
  })
})
