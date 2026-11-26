import { zodResolver } from '@hookform/resolvers/zod'
import { act, renderHook } from '@testing-library/react'
import type { SubmitEvent } from 'react'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'
import corporationValid from '../../../test/fixtures/corporation-valid.json'
import { recordRequests } from '../../../test/msw/recordRequests'
import { useCorporationNumberCheck } from '../hooks/useCorporationNumberCheck'
import { useProfileSubmission } from '../hooks/useProfileSubmission'
import {
  onboardingSchema,
  type OnboardingData,
  type OnboardingFormValues,
} from '../model/onboarding-form.schema'

/**
 * A gap the form tests cannot reach: React keeps the previous submit handler until it re-renders,
 * so a second submit can run it after the POST succeeded but before the form shows the success.
 * The test calls that handler directly. Only the network is mocked.
 */

const VALID_PROFILE: OnboardingFormValues = {
  firstName: 'Hello',
  lastName: 'World',
  phone: '+13062776103',
  corporationNumber: corporationValid.corporationNumber,
}

function renderSubmission() {
  return renderHook(() => {
    const verification = useCorporationNumberCheck()
    const form = useForm<OnboardingFormValues, unknown, OnboardingData>({
      resolver: zodResolver(onboardingSchema),
      defaultValues: VALID_PROFILE,
    })
    return useProfileSubmission({ form, verification })
  })
}

function submitEvent() {
  return {
    preventDefault: vi.fn(),
    persist: vi.fn(),
  } as unknown as SubmitEvent<HTMLFormElement> & { preventDefault: ReturnType<typeof vi.fn> }
}

describe('useProfileSubmission', () => {
  it('blocks a second submit handled before the success has re-rendered the form', async () => {
    const requests = recordRequests()
    const { result } = renderSubmission()
    // The handler the form holds until React re-renders it with the success state.
    const handlerBeforeSuccess = result.current.onSubmit

    await act(() => handlerBeforeSuccess(submitEvent()))
    expect(result.current.isSubmitted).toBe(true)

    const second = submitEvent()
    await act(() => handlerBeforeSuccess(second))

    expect(second.preventDefault).toHaveBeenCalled()
    expect(requests.matching('POST', /^\/profile-details$/)).toHaveLength(1)
  })
})
