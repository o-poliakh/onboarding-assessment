import { server } from './server'

const unhandled: string[] = []

/**
 * Installed once in `setup.ts`. With `onUnhandledFrame: 'error'`, MSW fails a request that has
 * no handler with a network error, but the app handles network errors itself, so a test that
 * expects one (a generic error message, a `network_error` report) would still pass when a URL is
 * wrong. Recording unhandled requests lets `setup.ts` fail the test that made one.
 */
export function recordUnhandledRequests() {
  server.events.on('request:unhandled', ({ request }) => {
    unhandled.push(`${request.method} ${request.url}`)
  })
}

/** Returns and clears the unhandled requests made since the last call. */
export function takeUnhandledRequests(): string[] {
  return unhandled.splice(0)
}
