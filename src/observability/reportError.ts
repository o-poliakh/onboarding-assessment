/** Where an error was observed. */
export type ErrorSource =
  | 'api'
  | 'react-uncaught'
  | 'react-caught'
  | 'react-recoverable'
  | 'window-error'
  | 'unhandled-rejection'

/**
 * Extra fields for grouping and triage. Only technical, non-personal values belong here
 * (an endpoint template, a status code, a component stack), never form input.
 */
export type ErrorContext = {
  source: ErrorSource
  [field: string]: string | number | boolean | undefined
}

/**
 * The single entry point for reporting errors from anywhere in the app. It writes to the
 * browser console; a monitoring service (Sentry, Datadog, …) would be called here instead,
 * without any change at the call sites.
 */
export function reportError(error: unknown, context: ErrorContext): void {
  console.error('[error report]', context, error)
}
