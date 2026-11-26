import { describe, expect, it } from 'vitest'
import {
  corporationNumberVerificationReducer as reduce,
  initialVerificationState,
} from '../model/corporation-number.reducer'
import type { CorporationNumberVerificationState } from '../model/corporation-number.types'

const A = '826417395'

// The form tests cover what the user sees of each transition. These cases pin the state the
// reducer produces, including the idle/pending distinction the UI does not show yet (there is no
// pending indicator). The reducer ignores the previous state, so one case per action is enough.
describe('corporationNumberVerificationReducer', () => {
  const invalidA: CorporationNumberVerificationState = {
    status: 'invalid',
    value: A,
    message: 'Invalid corporation number',
  }

  it('moves to pending for the value when a verification starts', () => {
    expect(reduce(invalidA, { type: 'started', value: A })).toEqual({ status: 'pending', value: A })
  })

  it('stores the outcome with its value when a verification settles', () => {
    const outcome = { status: 'error', errorType: 'timeout' } as const

    expect(reduce({ status: 'pending', value: A }, { type: 'settled', value: A, outcome })).toEqual(
      { ...outcome, value: A },
    )
  })

  it('returns to the initial idle state when invalidated', () => {
    expect(reduce(invalidA, { type: 'invalidated' })).toEqual({ status: 'idle' })
    expect(initialVerificationState).toEqual({ status: 'idle' })
  })
})
