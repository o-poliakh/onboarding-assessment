import { useCallback, useEffect, useReducer, useRef } from 'react'
import { verifyCorporationNumber } from '../api/verifyCorporationNumber'
import {
  corporationNumberVerificationReducer,
  initialVerificationState,
} from '../model/corporation-number.reducer'
import type {
  CorporationNumberVerificationResult,
  VerificationOutcome,
} from '../model/corporation-number.types'
import { corporationNumberSchema } from '../model/onboarding-form.schema'

/**
 * The verification of the current value: in flight, or settled with a final answer.
 * Its promise is also the cache: once settled, it resolves to the final outcome.
 */
type CurrentVerification = {
  value: string
  controller: AbortController
  promise: Promise<CorporationNumberVerificationResult>
}

const ABORTED: CorporationNumberVerificationResult = { status: 'aborted' }
const SKIPPED: CorporationNumberVerificationResult = { status: 'skipped' }

/**
 * Remote verification of the corporation number.
 *
 * - `check(value)` validates and normalizes the format locally, then reuses the current
 *   verification of the same value (in flight or final), otherwise starts a new one.
 * - `invalidate()` cancels and forgets the current verification. Call it on every change.
 *
 * Only the current value is ever kept, so `state` and the result of the latest `check` always
 * describe the same value. A ref, not state, holds it so blur and submit share one verification
 * before React re-renders.
 */
export function useCorporationNumberCheck() {
  const [state, dispatch] = useReducer(
    corporationNumberVerificationReducer,
    initialVerificationState,
  )
  const currentRef = useRef<CurrentVerification | null>(null)

  const settleIfCurrent = useCallback(
    (
      controller: AbortController,
      value: string,
      outcome: VerificationOutcome,
    ): CorporationNumberVerificationResult => {
      if (currentRef.current?.controller !== controller) {
        return ABORTED
      }
      // Technical errors are not kept, so the next check retries.
      if (outcome.status === 'error') {
        currentRef.current = null
      }
      dispatch({ type: 'settled', value, outcome })
      return outcome
    },
    [],
  )

  const start = useCallback(
    (value: string) => {
      currentRef.current?.controller.abort()
      const controller = new AbortController()
      // `.then` callbacks always run asynchronously, so `currentRef` is set before
      // `settleIfCurrent` reads it. The adapter never rejects: every failure is already an
      // `error` outcome.
      const promise = verifyCorporationNumber(value, controller.signal).then((outcome) =>
        settleIfCurrent(controller, value, outcome),
      )
      currentRef.current = { value, controller, promise }
      dispatch({ type: 'started', value })
      return promise
    },
    [settleIfCurrent],
  )

  const check = useCallback(
    (rawValue: string): Promise<CorporationNumberVerificationResult> => {
      const parsed = corporationNumberSchema.safeParse(rawValue)
      if (!parsed.success) {
        return Promise.resolve(SKIPPED)
      }
      // The normalized (trimmed) value is requested and reused, so a blur on " 826417395 "
      // and a submit of "826417395" share one verification.
      const value = parsed.data
      const current = currentRef.current

      return current?.value === value ? current.promise : start(value)
    },
    [start],
  )

  const invalidate = useCallback(() => {
    currentRef.current?.controller.abort()
    currentRef.current = null
    dispatch({ type: 'invalidated' })
  }, [])

  useEffect(
    () => () => {
      currentRef.current?.controller.abort()
      currentRef.current = null
    },
    [],
  )

  return { state, check, invalidate }
}
