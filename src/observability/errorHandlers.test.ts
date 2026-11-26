import { describe, expect, it } from 'vitest'
import { reportedErrors } from '../test/errorReports'
import { installGlobalErrorHandlers, rootErrorHandlers } from './errorHandlers'

const COMPONENT_STACK = '\n    at Broken (Broken.tsx:1:1)'

/**
 * A detached event target standing in for `window`: Vitest listens for `error` events on the
 * real window and would fail the run on the synthetic ones dispatched here.
 */
function fakeWindow() {
  return new EventTarget() as unknown as Window
}

describe('installGlobalErrorHandlers', () => {
  it('reports uncaught errors and unhandled promise rejections until uninstalled', () => {
    const target = fakeWindow()
    const uninstall = installGlobalErrorHandlers(target)
    const uncaught = new Error('uncaught')
    const rejection = new Error('rejected')

    target.dispatchEvent(new ErrorEvent('error', { error: uncaught, message: 'uncaught' }))
    target.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: rejection,
      }),
    )
    uninstall()
    target.dispatchEvent(new ErrorEvent('error', { error: new Error('after uninstall') }))
    target.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('after uninstall'),
      }),
    )

    expect(reportedErrors()).toEqual([
      { error: uncaught, context: { source: 'window-error' } },
      { error: rejection, context: { source: 'unhandled-rejection' } },
    ])
  })

  it('falls back to the message when an error event carries no error object', () => {
    const target = fakeWindow()
    const uninstall = installGlobalErrorHandlers(target)

    target.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }))
    uninstall()

    expect(reportedErrors()).toEqual([
      { error: 'Script error.', context: { source: 'window-error' } },
    ])
  })
})

describe('rootErrorHandlers', () => {
  it.each([
    ['onUncaughtError', 'react-uncaught'],
    ['onCaughtError', 'react-caught'],
    ['onRecoverableError', 'react-recoverable'],
  ] as const)('%s reports with the component stack', (handler, source) => {
    const error = new Error('render failed')

    rootErrorHandlers[handler](error, { componentStack: COMPONENT_STACK })

    expect(reportedErrors()).toEqual([
      { error, context: { source, componentStack: COMPONENT_STACK } },
    ])
  })
})
