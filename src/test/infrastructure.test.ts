import { describe, expect, it } from 'vitest'
import { env } from '../config/env'
import { takeUnhandledRequests } from './msw/unhandledRequests'

describe('test infrastructure', () => {
  describe('environment isolation', () => {
    it('points the API base URL to the isolated test host, never to the real API', () => {
      expect(env.apiBaseUrl).toBe('https://example.test')
    })
  })

  describe('network boundary', () => {
    it('fails requests that have no matching handler instead of reaching the network', async () => {
      const error: unknown = await fetch('https://unhandled.example.test/anything').catch(
        (reason: unknown) => reason,
      )

      // A DNS failure would also reject, so assert that MSW itself blocked the request.
      expect(error).toBeInstanceOf(TypeError)
      expect(String((error as TypeError).cause)).toContain('[MSW]')
      // Recorded, so setup.ts fails any test that makes such a request. Taken here because this
      // request is the expected one.
      expect(takeUnhandledRequests()).toEqual(['GET https://unhandled.example.test/anything'])
    })
  })
})
