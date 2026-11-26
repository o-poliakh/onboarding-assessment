import { zodResolver } from '@hookform/resolvers/zod'
import { useId, type FocusEvent } from 'react'
import { useForm, type GlobalError } from 'react-hook-form'
import { useCorporationNumberCheck } from '../hooks/useCorporationNumberCheck'
import { useErrorTitlePrefix } from '../hooks/useErrorTitlePrefix'
import { useProfileSubmission, type SubmissionErrorType } from '../hooks/useProfileSubmission'
import type {
  CorporationNumberVerificationState,
  VerificationErrorType,
} from '../model/corporation-number.types'
import {
  onboardingSchema,
  type OnboardingData,
  type OnboardingFormValues,
} from '../model/onboarding-form.schema'
import { FormField } from './FormField'
import styles from './OnboardingForm.module.css'

const DEFAULT_VALUES: OnboardingFormValues = {
  firstName: '',
  lastName: '',
  phone: '',
  corporationNumber: '',
}

const formMessages = {
  submitted: 'Profile details submitted successfully.',
  submissionTimeout:
    'The request timed out. Your details may already have been submitted. Please check before submitting again.',
  submissionFailed: 'Something went wrong. Please try again.',
  verificationTimeout: 'Verification timed out. Please try again.',
  verificationUnavailable: 'Unable to verify corporation number. Please try again.',
} as const

const SUBMISSION_ERROR_MESSAGES: Record<SubmissionErrorType, string> = {
  timeout: formMessages.submissionTimeout,
  failed: formMessages.submissionFailed,
}

const VERIFICATION_ERROR_MESSAGES: Record<VerificationErrorType, string> = {
  timeout: formMessages.verificationTimeout,
  unavailable: formMessages.verificationUnavailable,
}

/** A server rejection carries its own text; a technical failure carries only its type. */
function submissionErrorMessage(error: GlobalError) {
  if (error.type === 'timeout' || error.type === 'failed') {
    return SUBMISSION_ERROR_MESSAGES[error.type]
  }
  return error.message
}

function remoteCorporationNumberError(state: CorporationNumberVerificationState) {
  if (state.status === 'invalid') {
    return state.message
  }
  if (state.status === 'error') {
    return VERIFICATION_ERROR_MESSAGES[state.errorType]
  }
  return undefined
}

export function OnboardingForm() {
  const headingId = useId()
  const verification = useCorporationNumberCheck()

  const form = useForm<OnboardingFormValues, unknown, OnboardingData>({
    resolver: zodResolver(onboardingSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: DEFAULT_VALUES,
  })
  const {
    register,
    formState: { errors, isSubmitting, submitCount },
  } = form
  const submission = useProfileSubmission({ form, verification })

  // Local format errors (RHF) take precedence over the remote verification result.
  // The remote result always belongs to the current value: every change invalidates it.
  const corporationNumberError =
    errors.corporationNumber?.message ?? remoteCorporationNumberError(verification.state)

  // "Error: " in the page title, so a screen reader announces the problem first.
  // It waits for a submit: a blur before it shows only the inline error.
  const hasFieldErrors =
    [errors.firstName, errors.lastName, errors.phone].some(Boolean) ||
    corporationNumberError !== undefined
  useErrorTitlePrefix((submitCount > 0 && hasFieldErrors) || errors.root?.server !== undefined)

  // Fields are registered inline, in DOM order: RHF focuses the first invalid field by
  // registration order, so registering one field earlier would steal focus on submit.
  const corporationNumberHandlers = {
    onChange: verification.invalidate,
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      void verification.check(event.target.value)
    },
  }

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h1 id={headingId} className={styles.title}>
        Onboarding Form
      </h1>

      {/* noValidate: validation messages come from the app, not native browser bubbles. */}
      {/* onChange bubbles from every field: any edit after a success unlocks a new submission. */}
      <form
        className={styles.form}
        noValidate
        aria-busy={isSubmitting}
        onSubmit={submission.onSubmit}
        onChange={submission.markEdited}
      >
        <div className={styles.row}>
          <FormField
            label="First Name"
            type="text"
            autoComplete="given-name"
            autoCapitalize="words"
            spellCheck={false}
            required
            readOnly={isSubmitting}
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <FormField
            label="Last Name"
            type="text"
            autoComplete="family-name"
            autoCapitalize="words"
            spellCheck={false}
            required
            readOnly={isSubmitting}
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>

        <FormField
          label="Phone Number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          readOnly={isSubmitting}
          error={errors.phone?.message}
          {...register('phone')}
        />

        <FormField
          label="Corporation Number"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          required
          readOnly={isSubmitting}
          error={corporationNumberError}
          {...register('corporationNumber', corporationNumberHandlers)}
        />

        {errors.root?.server && (
          <p role="alert" className={styles.formError}>
            {submissionErrorMessage(errors.root.server)}
          </p>
        )}

        {/* preventDefault on mousedown keeps focus in the current field until the click lands.
            Otherwise the field blurs first, its error appears or clears, the button moves, and
            a click that started on it can end outside it and never fire. Submit validates every
            field anyway.
            aria-disabled, not disabled: a disabled button loses keyboard focus to <body> and
            nothing would bring it back after the result. Clicks and Enter still reach onSubmit,
            whose guards block them while submitting and after a success. */}
        <button
          type="submit"
          className={styles.submit}
          aria-disabled={isSubmitting || submission.isSubmitted || undefined}
          onMouseDown={(event) => event.preventDefault()}
        >
          Submit
          <svg
            className={styles.submitIcon}
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>

      {/* <output> has an implicit status role; always rendered so the message is announced. */}
      <output className={styles.success}>
        {submission.isSubmitted ? formMessages.submitted : ''}
      </output>
    </section>
  )
}
