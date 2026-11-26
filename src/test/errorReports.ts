import { vi, type MockInstance } from 'vitest'
import type { ErrorContext } from '../observability/reportError'

type ErrorReport = { error: unknown; context: ErrorContext }

/** The first argument `reportError` passes to `console.error`. */
const REPORT_PREFIX = '[error report]'

let consoleError: MockInstance<typeof console.error> | undefined

/**
 * Installed before each test in `setup.ts`: error reports are recorded instead of logged, so
 * expected failures stay out of the test output and tests can assert on them. Any other
 * `console.error` call (a React warning, for example) still reaches the console.
 */
export function recordErrorReports() {
  const originalConsoleError = console.error
  consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] !== REPORT_PREFIX) {
      originalConsoleError(...args)
    }
  })
}

export function reportedErrors(): ErrorReport[] {
  return (consoleError?.mock.calls ?? [])
    .filter(([prefix]) => prefix === REPORT_PREFIX)
    .map(([, context, error]) => ({ error, context: context as ErrorContext }))
}
