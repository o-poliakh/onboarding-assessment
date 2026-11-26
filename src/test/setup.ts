import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest'
import { recordErrorReports } from './errorReports'
import { server } from './msw/server'
import { recordUnhandledRequests, takeUnhandledRequests } from './msw/unhandledRequests'

// Any request without a matching handler fails the test instead of
// silently reaching the real network.
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  recordUnhandledRequests()
})

// The app turns an unhandled request into a network error it handles itself, so the 'error'
// strategy alone would not fail a test that expects such an error. See unhandledRequests.ts.
afterEach(() => {
  const unhandled = takeUnhandledRequests()
  if (unhandled.length > 0) {
    throw new Error(`Requests without a matching handler: ${unhandled.join(', ')}`)
  }
})

// Error reports are recorded, not logged, so tests can assert on them (see errorReports.ts).
beforeEach(() => {
  recordErrorReports()
})

afterEach(() => {
  // With `globals: false` RTL does not register auto-cleanup,
  // so rendered trees must be unmounted explicitly.
  cleanup()
  server.resetHandlers()
  vi.restoreAllMocks()
})

afterAll(() => {
  server.close()
})
