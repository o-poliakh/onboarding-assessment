import type { RootOptions } from 'react-dom/client'
import { reportError, type ErrorSource } from './reportError'

function reportReactError(source: ErrorSource) {
  return (error: unknown, errorInfo: { componentStack?: string | null | undefined }) => {
    reportError(error, { source, componentStack: errorInfo.componentStack ?? undefined })
  }
}

/**
 * Root callbacks for `createRoot`. They replace React's default console logging,
 * so every render error is reported exactly once.
 *
 * Passed in development too, unlike the react.dev example: dev and prod then report the same
 * way, and `reportError` already logs the error with its component stack.
 */
export const rootErrorHandlers = {
  onUncaughtError: reportReactError('react-uncaught'),
  onCaughtError: reportReactError('react-caught'),
  onRecoverableError: reportReactError('react-recoverable'),
} satisfies RootOptions

function reportWindowError(event: ErrorEvent) {
  // Cross-origin scripts expose only a message ("Script error."), not the error object.
  reportError(event.error ?? event.message, { source: 'window-error' })
}

function reportUnhandledRejection(event: PromiseRejectionEvent) {
  reportError(event.reason, { source: 'unhandled-rejection' })
}

/**
 * Reports errors that escape React and every `catch`: uncaught exceptions outside rendering
 * and promise rejections nobody handled. Returns a function that removes the listeners.
 */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  target.addEventListener('error', reportWindowError)
  target.addEventListener('unhandledrejection', reportUnhandledRejection)

  return () => {
    target.removeEventListener('error', reportWindowError)
    target.removeEventListener('unhandledrejection', reportUnhandledRejection)
  }
}
