import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import corporationValid from '../../../test/fixtures/corporation-valid.json'
import { apiUrl } from '../../../test/msw/handlers'
import { server } from '../../../test/msw/server'
import { useCorporationNumberCheck } from '../hooks/useCorporationNumberCheck'
import type { CorporationNumberVerificationResult } from '../model/corporation-number.types'

/**
 * Hook guarantees the form tests cannot reach: the form calls `invalidate` on every change, so it
 * never checks another value without one. The rest of the hook is covered through the form and
 * by the random-sequence test (`useCorporationNumberCheck.model.test.tsx`).
 */

const VALID = corporationValid.corporationNumber
const OTHER = '222222222'
const VALID_RESULT = { status: 'valid' }

/** Awaits a check inside act, so the state updates it causes are applied before asserting. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  let value!: T
  await act(async () => {
    value = await promise
  })
  return value
}

/** Lets fetch, MSW and the hook's promise chain finish. */
function flush() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

function renderCheck() {
  const hook = renderHook(() => useCorporationNumberCheck())
  const check = (raw: string) => {
    let promise!: Promise<CorporationNumberVerificationResult>
    act(() => {
      promise = hook.result.current.check(raw)
    })
    return promise
  }
  const settledCheck = async (raw: string) => {
    const result = await settled(check(raw))
    await flush()
    return result
  }
  return { hook, check, settledCheck }
}

// They pin what the form relies on ("the remote result always belongs to the current value")
// without depending on the caller's discipline.
describe('useCorporationNumberCheck: state follows the latest check, even without invalidate', () => {
  it('A (valid) → B (pending) → A: the result for A and the state agree', async () => {
    let respondToOther!: (response: Response) => void
    server.use(
      http.get(apiUrl.corporationNumber, ({ params }) =>
        params.number === OTHER
          ? new Promise<Response>((resolve) => {
              respondToOther = resolve
            })
          : HttpResponse.json(corporationValid),
      ),
    )
    const { hook, check, settledCheck } = renderCheck()

    await settledCheck(VALID)
    check(OTHER)
    await flush()
    const result = await settledCheck(VALID)
    // A late answer for B must not take over the state of A.
    respondToOther(HttpResponse.json({ corporationNumber: OTHER, valid: true }))
    await flush()

    expect(result).toEqual(VALID_RESULT)
    expect(hook.result.current.state).toEqual({ ...VALID_RESULT, value: VALID })
  })

  it('A (valid) → B (error) → A: the result for A and the state agree', async () => {
    server.use(
      http.get(apiUrl.corporationNumber, ({ params }) =>
        params.number === OTHER
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json(corporationValid),
      ),
    )
    const { hook, settledCheck } = renderCheck()

    await settledCheck(VALID)
    await settledCheck(OTHER)
    const result = await settledCheck(VALID)

    expect(result).toEqual(VALID_RESULT)
    expect(hook.result.current.state).toEqual({ ...VALID_RESULT, value: VALID })
  })
})
