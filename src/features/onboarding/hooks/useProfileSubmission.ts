import { useRef, useState, type SubmitEvent } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { submitProfileDetails } from '../api/onboarding.api'
import { isTimeoutError } from '../api/onboarding.errors'
import type { CorporationNumberVerificationResult } from '../model/corporation-number.types'
import type { OnboardingData, OnboardingFormValues } from '../model/onboarding-form.schema'

/** Why a submission failed technically. UI text is chosen by the presentation layer. */
export type SubmissionErrorType = 'timeout' | 'failed'

type OnboardingForm = Pick<
  UseFormReturn<OnboardingFormValues, unknown, OnboardingData>,
  'handleSubmit' | 'setError' | 'setFocus'
>

type ProfileSubmissionOptions = {
  form: OnboardingForm
  /**
   * The form's `useCorporationNumberCheck`: `check` reuses the in-flight or settled verification
   * and starts one only if needed. Not the raw API call, which would bypass both.
   */
  verification: { check: (value: string) => Promise<CorporationNumberVerificationResult> }
}

/**
 * The submit flow of the onboarding form: verify the corporation number, then post the profile.
 *
 * - At most one POST at a time, even for a second submit before React re-renders.
 * - After a success, the same details are not posted again until `markEdited()` is called:
 *   the API has no idempotency key, so a repeated POST would create a duplicate.
 * - A failure becomes `errors.root.server` in the form: a server rejection with the server's
 *   message, a technical failure with only its `SubmissionErrorType`.
 */
export function useProfileSubmission({ form, verification }: ProfileSubmissionOptions) {
  const { handleSubmit, setError, setFocus } = form
  const [isSubmitted, setIsSubmitted] = useState(false)
  const submittingRef = useRef(false)
  // The success is kept in a ref too: a submit handled before React re-renders runs the previous
  // handler, which still sees the old `isSubmitted`, so the guard must not rely on state.
  const submittedRef = useRef(false)

  const setSubmitted = (submitted: boolean) => {
    submittedRef.current = submitted
    setIsSubmitted(submitted)
  }

  const submitValidProfile = async (data: OnboardingData) => {
    const verificationResult = await verification.check(data.corporationNumber)
    // Fields are read-only while submitting, so the only way to abort here is unmounting,
    // where moving focus is a no-op. Every other non-valid outcome is shown on the field.
    if (verificationResult.status !== 'valid') {
      setFocus('corporationNumber')
      return
    }

    try {
      const result = await submitProfileDetails(data)
      if (result.ok) {
        setSubmitted(true)
      } else {
        setError('root.server', { type: 'server', message: result.message })
      }
    } catch (error) {
      const type: SubmissionErrorType = isTimeoutError(error) ? 'timeout' : 'failed'
      setError('root.server', { type })
    }
  }

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    // Synchronous guards (refs, not state): a second submit before React re-renders must not
    // start another POST, while one runs or after a success until the user edits a field.
    if (submittingRef.current || submittedRef.current) {
      event.preventDefault()
      return
    }
    submittingRef.current = true
    try {
      await handleSubmit(submitValidProfile)(event)
    } finally {
      submittingRef.current = false
    }
  }

  const markEdited = () => setSubmitted(false)

  return { isSubmitted, onSubmit, markEdited }
}
