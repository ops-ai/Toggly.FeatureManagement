import { describe, expect, it } from 'vitest'
import {
  createSegmentMembershipClient,
  SegmentMembershipError,
} from '../src/main/index.js'

describe('segment membership re-exports', () => {
  it('exposes createSegmentMembershipClient from @ops-ai/toggly-segments', () => {
    expect(typeof createSegmentMembershipClient).toBe('function')
  })

  it('exposes SegmentMembershipError from @ops-ai/toggly-segments', () => {
    expect(typeof SegmentMembershipError).toBe('function')
    expect(new SegmentMembershipError('test')).toBeInstanceOf(Error)
  })
})
