import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OnboardingForm } from '../features/onboarding/components/OnboardingForm'
import { rootErrorHandlers } from '../observability/errorHandlers'
import { reportedErrors } from '../test/errorReports'
import { App } from './App'

// Keeps the real form but wraps its export in a spy, so a test can make it fail to render.
vi.mock('../features/onboarding/components/OnboardingForm', { spy: true })

function renderApp() {
  // The same handlers as in main.tsx, so errors caught by the boundary are reported.
  return render(<App />, { onCaughtError: rootErrorHandlers.onCaughtError })
}

afterEach(() => {
  // Back to the real implementation.
  vi.mocked(OnboardingForm).mockReset()
})

describe('App error boundary', () => {
  it('replaces a crashed form with a fallback, keeps the page and reports the error', () => {
    vi.mocked(OnboardingForm).mockImplementation(() => {
      throw new Error('Form render failed')
    })
    renderApp()

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    // Clicking it calls location.reload(), which jsdom can neither run nor spy on.
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Onboarding Form' })).not.toBeInTheDocument()
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()

    expect(reportedErrors()).toEqual([
      {
        error: expect.objectContaining({ message: 'Form render failed' }),
        context: {
          source: 'react-caught',
          componentStack: expect.stringContaining('OnboardingForm'),
        },
      },
    ])
  })

  it('renders the step indicator and the real form inside the main landmark when nothing fails', () => {
    renderApp()
    const main = within(screen.getByRole('main'))

    expect(main.getByText('Step 1 of 5')).toBeInTheDocument()
    expect(main.getByRole('heading', { level: 1, name: 'Onboarding Form' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(reportedErrors()).toEqual([])
  })
})
