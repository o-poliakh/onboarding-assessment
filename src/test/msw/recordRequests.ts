import { onTestFinished } from 'vitest'
import { server } from './server'

/**
 * Records every request that reaches the MSW boundary during the current test.
 * Requests are cloned so tests can read their bodies after the app has consumed them.
 */
export function recordRequests() {
  const requests: Request[] = []

  const listener = ({ request }: { request: Request }) => {
    requests.push(request.clone())
  }

  server.events.on('request:start', listener)
  onTestFinished(() => {
    server.events.removeListener('request:start', listener)
  })

  return {
    matching(method: string, pathname: RegExp): Request[] {
      return requests.filter(
        (request) => request.method === method && pathname.test(new URL(request.url).pathname),
      )
    },
  }
}
