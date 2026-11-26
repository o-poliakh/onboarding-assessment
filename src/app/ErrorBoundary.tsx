import { Component, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
  fallback: ReactNode
}

type ErrorBoundaryState = { hasError: boolean }

/**
 * Only switches the UI: the error is reported once, by the root's `onCaughtError`
 * (see `observability/errorHandlers.ts`). Event handler and async errors are not caught
 * here; the form handles those as typed results.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}
