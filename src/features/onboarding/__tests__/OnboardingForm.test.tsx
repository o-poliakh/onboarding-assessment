import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import corporationInvalid from '../../../test/fixtures/corporation-invalid.json'
import corporationValid from '../../../test/fixtures/corporation-valid.json'
import profileDetailsError from '../../../test/fixtures/profile-details-error.json'
import { apiUrl } from '../../../test/msw/handlers'
import { recordRequests } from '../../../test/msw/recordRequests'
import { server } from '../../../test/msw/server'
import { REQUEST_TIMEOUT_MS } from '../api/onboarding.api'
import { OnboardingForm } from '../components/OnboardingForm'

const CORPORATION_CHECK = /^\/corporation-number\/\d+$/
const PROFILE_DETAILS = /^\/profile-details$/

const VALID_NUMBER = corporationValid.corporationNumber
const INVALID_NUMBER = '111111111'

const VALID_PROFILE = {
  firstName: 'Hello',
  lastName: 'World',
  phone: '+13062776103',
  corporationNumber: VALID_NUMBER,
}

const SUCCESS_MESSAGE = 'Profile details submitted successfully.'

/**
 * Submit is locked with aria-disabled, never disabled: a disabled button that has keyboard focus
 * drops it to <body>. jsdom does not reproduce that focus loss, so `not.toBeDisabled()` guards it.
 */
function expectLocked(submit: HTMLElement) {
  expect(submit).toHaveAttribute('aria-disabled', 'true')
  expect(submit).not.toBeDisabled()
}

function expectUnlocked(submit: HTMLElement) {
  expect(submit).not.toHaveAttribute('aria-disabled')
}

function renderForm(options: { advanceTimers?: (ms: number) => void } = {}) {
  const user = userEvent.setup(
    options.advanceTimers ? { advanceTimers: options.advanceTimers } : {},
  )
  const { unmount } = render(<OnboardingForm />)

  const fields = {
    firstName: screen.getByRole('textbox', { name: 'First Name' }),
    lastName: screen.getByRole('textbox', { name: 'Last Name' }),
    phone: screen.getByRole('textbox', { name: 'Phone Number' }),
    corporationNumber: screen.getByRole('textbox', { name: 'Corporation Number' }),
  }
  const submit = screen.getByRole('button', { name: 'Submit' })

  return { user, fields, submit, unmount }
}

type Fields = ReturnType<typeof renderForm>['fields']

async function fillForm(
  user: UserEvent,
  fields: Fields,
  values: Partial<typeof VALID_PROFILE> = {},
) {
  const profile = { ...VALID_PROFILE, ...values }
  for (const [name, value] of Object.entries(profile) as [keyof Fields, string][]) {
    await user.clear(fields[name])
    if (value) {
      await user.type(fields[name], value)
    }
  }
}

/** A response the test resolves explicitly, to control when and in which order requests finish. */
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/**
 * Half the request timeout: longer than any debounce, retry or delayed call the form could add,
 * while a request the test keeps pending still cannot time out.
 */
const SETTLE_MS = REQUEST_TIMEOUT_MS / 2

/**
 * Runs every timer the app schedules within SETTLE_MS, in fake time, so a "no request was sent"
 * or "nothing changed" assertion cannot pass just because a delayed call has not fired yet.
 * A fixed real-time sleep would only cover delays shorter than the sleep itself.
 */
async function settleNetwork() {
  if (!vi.isFakeTimers()) {
    throw new Error('settleNetwork() needs renderWithControllableTimers()')
  }
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
}

/**
 * A blocked submit must still be cancelled: otherwise the browser falls back to a native GET
 * submission of this action-less form, which reloads the page and puts the details in the URL.
 * fireEvent returns false when the default action was prevented. This shows the cancellation,
 * not that the POST was stopped: React Hook Form's handleSubmit cancels every submit it handles,
 * so callers also assert the POST count.
 */
function expectSubmitCancelled(notCancelled: boolean) {
  expect(notCancelled).toBe(false)
}

const PAGE_TITLE = 'Onboarding Form'
function expectSuccessMessage() {
  return waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SUCCESS_MESSAGE))
}

/** Fake timers that the request timeout and user-event can both be driven by. */
function renderWithControllableTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  return renderForm({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
}

beforeEach(() => {
  // jsdom does not load index.html, so the page title is set here.
  document.title = PAGE_TITLE
})

afterEach(() => {
  vi.useRealTimers()
})

describe('OnboardingForm', () => {
  describe('happy path', () => {
    it('verifies the corporation number on blur and submits the profile details', async () => {
      const requests = recordRequests()
      const { user, fields, submit } = renderForm()

      await fillForm(user, fields)

      // Leaving the field triggers exactly one asynchronous verification.
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(0)
      expect(screen.getByRole('status')).toBeEmptyDOMElement()

      await user.click(submit)
      await expectSuccessMessage()

      const posts = requests.matching('POST', PROFILE_DETAILS)
      expect(posts).toHaveLength(1)
      expect(await posts[0]?.json()).toEqual(VALID_PROFILE)
      // A verified, unchanged number is reused on submit instead of being checked again.
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1)
    })

    it('sends trimmed names and accepts a pasted phone and corporation number with surrounding spaces', async () => {
      const requests = recordRequests()
      const { user, fields, submit } = renderForm()

      await fillForm(user, fields, {
        firstName: '  Hello ',
        lastName: ' World  ',
        phone: '',
        corporationNumber: '',
      })
      await user.click(fields.phone)
      await user.paste(` ${VALID_PROFILE.phone} `)
      await user.click(fields.corporationNumber)
      await user.paste(` ${VALID_NUMBER} `)
      await user.tab()

      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))
      expect(new URL(requests.matching('GET', CORPORATION_CHECK)[0]?.url ?? '').pathname).toBe(
        `/corporation-number/${VALID_NUMBER}`,
      )
      expect(fields.phone).not.toHaveAttribute('aria-invalid')

      await user.click(submit)
      await expectSuccessMessage()

      expect(await requests.matching('POST', PROFILE_DETAILS)[0]?.json()).toEqual(VALID_PROFILE)
      // The trimmed number verified on blur is reused on submit.
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1)
    })
  })

  describe('input affordances', () => {
    it('gives each field the keyboard, autofill and spelling hints it needs', () => {
      const { fields } = renderForm()

      expect(fields.firstName).toHaveAttribute('autocomplete', 'given-name')
      expect(fields.lastName).toHaveAttribute('autocomplete', 'family-name')
      expect(fields.phone).toHaveAttribute('type', 'tel')
      expect(fields.phone).toHaveAttribute('autocomplete', 'tel')
      expect(fields.corporationNumber).toHaveAttribute('inputmode', 'numeric')
      expect(fields.corporationNumber).toHaveAttribute('autocomplete', 'off')
      for (const field of [fields.firstName, fields.lastName, fields.corporationNumber]) {
        expect(field).toHaveAttribute('spellcheck', 'false')
      }
      for (const field of Object.values(fields)) {
        expect(field).toBeRequired()
      }
    })
  })

  describe('local validation', () => {
    it('shows a message under every empty field on submit and sends nothing', async () => {
      const requests = recordRequests()
      const { user, fields, submit } = renderForm()

      await user.click(submit)

      expect(fields.firstName).toHaveAccessibleDescription('First name is required')
      expect(fields.lastName).toHaveAccessibleDescription('Last name is required')
      expect(fields.phone).toHaveAccessibleDescription('Phone number is required')
      expect(fields.corporationNumber).toHaveAccessibleDescription('Corporation number is required')
      for (const field of Object.values(fields)) {
        expect(field).toHaveAttribute('aria-invalid', 'true')
      }
      expect(fields.firstName).toHaveFocus()
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(0)
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(0)
    })

    it('validates a field when the user leaves it, not while typing', async () => {
      const { user, fields } = renderForm()

      await user.type(fields.phone, '+12025550123')
      expect(fields.phone).not.toHaveAttribute('aria-invalid')

      await user.tab()

      expect(fields.phone).toHaveAccessibleDescription('Enter a valid Canadian phone number')
      expect(fields.phone).toHaveAttribute('aria-invalid', 'true')
      // The title prefix belongs to a submit attempt, not to a single blur.
      expect(document.title).toBe(PAGE_TITLE)
    })

    it('does not blur the current field when Submit is pressed, so its error cannot move the button mid-click', async () => {
      const { user, fields, submit } = renderForm()

      await user.type(fields.corporationNumber, '123')
      await user.pointer({ keys: '[MouseLeft>]', target: submit })

      expect(fields.corporationNumber).toHaveFocus()
      expect(fields.corporationNumber).not.toHaveAttribute('aria-invalid')

      await user.pointer({ keys: '[/MouseLeft]', target: submit })

      // The click still submits: errors appear and focus moves to the first invalid field.
      expect(fields.corporationNumber).toHaveAccessibleDescription(
        'Corporation number must be 9 digits',
      )
      expect(fields.firstName).toHaveFocus()
    })
  })

  describe('page title', () => {
    it('gets an "Error: " prefix after a failed submit until every error is fixed', async () => {
      const { user, fields, submit } = renderForm()

      await user.click(submit)
      expect(document.title).toBe(`Error: ${PAGE_TITLE}`)

      // The prefix stays while any field still has an error.
      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.type(fields.firstName, VALID_PROFILE.firstName)
      await user.type(fields.lastName, VALID_PROFILE.lastName)
      expect(document.title).toBe(`Error: ${PAGE_TITLE}`)

      await user.type(fields.phone, VALID_PROFILE.phone)
      expect(document.title).toBe(PAGE_TITLE)
    })

    it('gets the prefix and posts nothing when submit is stopped by the server rejecting the number', async () => {
      const requests = recordRequests()
      const { user, fields, submit } = renderWithControllableTimers()

      // No blur before Submit: the verification runs as part of the submit.
      await fillForm(user, fields, { corporationNumber: INVALID_NUMBER })
      await user.click(submit)

      // Focus is already on the number after typing it, so wait for the 404 result itself.
      await waitFor(() => expect(document.title).toBe(`Error: ${PAGE_TITLE}`))
      expect(fields.corporationNumber).toHaveAccessibleDescription(corporationInvalid.message)
      expect(fields.corporationNumber).toHaveFocus()
      await settleNetwork()
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(0)
    })
  })

  describe('corporation number verification', () => {
    it('does not call the API while typing a complete number, only when the user leaves the field', async () => {
      const requests = recordRequests()
      const { user, fields } = renderWithControllableTimers()

      // A complete, well-formed number: a check while typing would really send a request.
      await user.type(fields.corporationNumber, VALID_NUMBER)
      await settleNetwork()
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(0)

      await user.tab()

      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))
    })

    it('does not call the API for a malformed number', async () => {
      const requests = recordRequests()
      const { user, fields } = renderWithControllableTimers()

      await user.type(fields.corporationNumber, '12345678')
      await user.tab()
      await settleNetwork()

      expect(fields.corporationNumber).toHaveAccessibleDescription(
        'Corporation number must be 9 digits',
      )
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(0)
    })

    it('shows the server message under the field for an invalid number and clears it as soon as the number changes', async () => {
      const { user, fields } = renderForm()

      await user.type(fields.corporationNumber, INVALID_NUMBER)
      await user.tab()
      await waitFor(() =>
        expect(fields.corporationNumber).toHaveAccessibleDescription(corporationInvalid.message),
      )
      expect(fields.corporationNumber).toHaveAttribute('aria-invalid', 'true')

      await user.type(fields.corporationNumber, '{Backspace}')

      expect(fields.corporationNumber).not.toHaveAttribute('aria-invalid')
    })

    it('shows a retryable error when verification fails and retries on the next blur', async () => {
      const requests = recordRequests()
      server.use(
        http.get(apiUrl.corporationNumber, () => new HttpResponse(null, { status: 500 }), {
          once: true,
        }),
      )
      const { user, fields } = renderForm()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await waitFor(() =>
        expect(fields.corporationNumber).toHaveAccessibleDescription(
          'Unable to verify corporation number. Please try again.',
        ),
      )

      await user.click(fields.corporationNumber)
      await user.tab()

      await waitFor(() => expect(fields.corporationNumber).not.toHaveAttribute('aria-invalid'))
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(2)
    })

    it('reuses a rejection from blur on submit instead of checking again', async () => {
      const requests = recordRequests()
      const { user, fields, submit } = renderWithControllableTimers()

      await fillForm(user, fields, { corporationNumber: INVALID_NUMBER })
      await user.tab()
      await waitFor(() =>
        expect(fields.corporationNumber).toHaveAccessibleDescription(corporationInvalid.message),
      )

      await user.click(submit)
      await waitFor(() => expect(fields.corporationNumber).toHaveFocus())
      await settleNetwork()

      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1)
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(0)
    })

    it('cancels a pending verification when the form unmounts', async () => {
      const requests = recordRequests()
      server.use(http.get(apiUrl.corporationNumber, () => deferred().promise))
      const { user, fields, unmount } = renderForm()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))

      unmount()

      expect(requests.matching('GET', CORPORATION_CHECK)[0]?.signal.aborted).toBe(true)
    })

    it('verifies again after the number changes and returns to a verified value (A → B → A)', async () => {
      const requests = recordRequests()
      const { user, fields } = renderWithControllableTimers()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))

      await user.clear(fields.corporationNumber)
      await user.type(fields.corporationNumber, INVALID_NUMBER)
      await user.clear(fields.corporationNumber)
      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()

      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(2))
      await settleNetwork()
      expect(fields.corporationNumber).not.toHaveAttribute('aria-invalid')
      expect(fields.corporationNumber).not.toHaveAccessibleDescription()
    })

    it('shows no error when the number is edited while its verification is pending', async () => {
      const requests = recordRequests()
      server.use(http.get(apiUrl.corporationNumber, () => deferred().promise))
      const { user, fields } = renderWithControllableTimers()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))

      // Editing cancels the pending check; the cancellation is not a failure to show.
      await user.type(fields.corporationNumber, '{Backspace}')
      await settleNetwork()

      expect(fields.corporationNumber).not.toHaveAttribute('aria-invalid')
      expect(fields.corporationNumber).not.toHaveAccessibleDescription()
    })

    // Programmatic input (autofill, a password manager, a script) can change and leave the field
    // within one task, so a new verification starts before the cancelled one has finished.
    it('ignores a cancelled verification when the same number is entered again in one go', async () => {
      const requests = recordRequests()
      let checks = 0
      server.use(
        http.get(apiUrl.corporationNumber, () => {
          checks += 1
          return checks === 1 ? deferred().promise : HttpResponse.json(corporationValid)
        }),
      )
      const { user, fields } = renderWithControllableTimers()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))

      fireEvent.change(fields.corporationNumber, { target: { value: INVALID_NUMBER } })
      fireEvent.change(fields.corporationNumber, { target: { value: VALID_NUMBER } })
      fireEvent.blur(fields.corporationNumber)
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(2))
      await settleNetwork()

      // The cancelled first check is for the same number, but it must not replace the new result.
      expect(fields.corporationNumber).not.toHaveAttribute('aria-invalid')
      expect(fields.corporationNumber).not.toHaveAccessibleDescription()
    })

    // In the form, an edit aborts the previous request, so its late response never reaches the app:
    // this test proves the abort. The hook's guard against a replaced request that settles anyway
    // is tested in useCorporationNumberCheck.model.test.tsx, where settling is controlled directly.
    it('cancels the check for a previous number, so its late response cannot replace the result', async () => {
      const requests = recordRequests()
      const slowValid = deferred()
      server.use(
        http.get(apiUrl.corporationNumber, ({ params }) =>
          params.number === VALID_NUMBER
            ? slowValid.promise
            : HttpResponse.json(corporationInvalid, { status: 404 }),
        ),
      )
      const { user, fields } = renderWithControllableTimers()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await user.clear(fields.corporationNumber)
      await user.type(fields.corporationNumber, INVALID_NUMBER)
      await user.tab()
      await waitFor(() =>
        expect(fields.corporationNumber).toHaveAccessibleDescription(corporationInvalid.message),
      )
      const [previousCheck] = requests.matching('GET', CORPORATION_CHECK)
      expect(previousCheck?.signal.aborted).toBe(true)

      slowValid.resolve(HttpResponse.json(corporationValid))

      // The late "valid" answer for the previous number must not replace the current result.
      await settleNetwork()
      expect(fields.corporationNumber).toHaveAccessibleDescription(corporationInvalid.message)
    })
  })

  describe('submission', () => {
    it('joins a verification started on blur that is still pending', async () => {
      const requests = recordRequests()
      const verification = deferred()
      server.use(http.get(apiUrl.corporationNumber, () => verification.promise))
      const { user, fields, submit } = renderWithControllableTimers()

      await fillForm(user, fields)
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))

      await user.click(submit)
      await settleNetwork()
      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1)
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(0)

      verification.resolve(HttpResponse.json(corporationValid))
      await expectSuccessMessage()

      expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1)
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(1)
    })

    it('locks the form while submitting and sends a single POST on repeated submits', async () => {
      const requests = recordRequests()
      const submission = deferred()
      server.use(http.post(apiUrl.profileDetails, () => submission.promise))
      const { user, fields, submit } = renderForm()

      await fillForm(user, fields)
      await user.tab()
      await waitFor(() => expect(requests.matching('GET', CORPORATION_CHECK)).toHaveLength(1))

      const form = submit.closest('form')
      if (!form) throw new Error('form not found')
      // Two submits in one task, before React re-renders and disables the button, so only the
      // synchronous guard can stop the second one. user-event lets React re-render between
      // events, so it cannot reproduce this. The POST count below proves the second submit was
      // stopped; the return value proves it was also cancelled (see expectSubmitCancelled).
      fireEvent.submit(form)
      expectSubmitCancelled(fireEvent.submit(form))

      await waitFor(() => expectLocked(submit))
      for (const field of Object.values(fields)) {
        expect(field).toHaveAttribute('readonly')
      }

      submission.resolve(new HttpResponse(null, { status: 200 }))
      await expectSuccessMessage()

      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(1)
      expect(fields.firstName).not.toHaveAttribute('readonly')
    })

    it('keeps keyboard focus on Submit while submitting and after a success', async () => {
      const submission = deferred()
      server.use(http.post(apiUrl.profileDetails, () => submission.promise))
      const { user, fields, submit } = renderForm()

      await fillForm(user, fields)
      await user.tab()
      expect(submit).toHaveFocus()

      await user.keyboard('{Enter}')
      await waitFor(() => expectLocked(submit))
      expect(submit).toHaveFocus()

      submission.resolve(new HttpResponse(null, { status: 200 }))
      await expectSuccessMessage()
      expectLocked(submit)
      expect(submit).toHaveFocus()
    })

    it('does not post the same details again after a success until a field is edited', async () => {
      const requests = recordRequests()
      const { user, fields, submit } = renderWithControllableTimers()

      await fillForm(user, fields)
      await user.click(submit)
      await expectSuccessMessage()

      expectLocked(submit)
      const form = submit.closest('form')
      if (!form) throw new Error('form not found')
      // The button is only aria-disabled, so a click, Enter and a programmatic submit (such as
      // form.requestSubmit() from an autofill extension) all reach the submit handler, which
      // must stop each of them.
      await user.click(submit)
      await user.type(fields.lastName, '{Enter}')
      expectSubmitCancelled(fireEvent.submit(form))
      await settleNetwork()
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(1)

      await user.type(fields.lastName, 's')

      expectUnlocked(submit)
      expect(screen.getByRole('status')).toBeEmptyDOMElement()

      await user.click(submit)
      await expectSuccessMessage()
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(2)
    })

    it('shows the server message for a rejected submission and lets the user retry', async () => {
      server.use(
        http.post(
          apiUrl.profileDetails,
          () => HttpResponse.json(profileDetailsError, { status: 400 }),
          { once: true },
        ),
      )
      const { user, fields, submit } = renderForm()

      await fillForm(user, fields)
      await user.click(submit)

      expect(await screen.findByRole('alert')).toHaveTextContent(profileDetailsError.message)
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      expect(document.title).toBe(`Error: ${PAGE_TITLE}`)

      await user.click(submit)
      await expectSuccessMessage()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(document.title).toBe(PAGE_TITLE)
    })

    it('shows a generic error when the network fails', async () => {
      server.use(http.post(apiUrl.profileDetails, () => HttpResponse.error()))
      const { user, fields, submit } = renderForm()

      await fillForm(user, fields)
      await user.click(submit)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Something went wrong. Please try again.',
      )
      expectUnlocked(submit)
    })
  })

  describe('timeouts', () => {
    it('reports a verification timeout under the field', async () => {
      server.use(http.get(apiUrl.corporationNumber, () => deferred().promise))
      const { user, fields } = renderWithControllableTimers()

      await user.type(fields.corporationNumber, VALID_NUMBER)
      await user.tab()
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

      await waitFor(() =>
        expect(fields.corporationNumber).toHaveAccessibleDescription(
          'Verification timed out. Please try again.',
        ),
      )
    })

    it('warns that a timed-out submission may have succeeded and unlocks the form', async () => {
      const requests = recordRequests()
      server.use(http.post(apiUrl.profileDetails, () => deferred().promise))
      const { user, fields, submit } = renderWithControllableTimers()

      await fillForm(user, fields)
      await user.click(submit)
      await waitFor(() => expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(1))
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Your details may already have been submitted',
      )
      expectUnlocked(submit)
      expect(fields.firstName).not.toHaveAttribute('readonly')
      // No automatic retry of a POST whose outcome is unknown, not even a delayed one.
      await settleNetwork()
      expect(requests.matching('POST', PROFILE_DETAILS)).toHaveLength(1)
    })
  })
})
