import type {
  CorporationNumberVerificationAction,
  CorporationNumberVerificationState,
} from './corporation-number.types'

export const initialVerificationState: CorporationNumberVerificationState = { status: 'idle' }

/**
 * Contract: `settled` is dispatched only for the current request, so it always follows the
 * `started` of the same value and is applied as is. `useCorporationNumberCheck` owns the request
 * lifecycle and request identity and discards the results of replaced or cancelled requests.
 */
export function corporationNumberVerificationReducer(
  _state: CorporationNumberVerificationState,
  action: CorporationNumberVerificationAction,
): CorporationNumberVerificationState {
  switch (action.type) {
    case 'started':
      return { status: 'pending', value: action.value }

    case 'invalidated':
      // Always the same object, so invalidating an idle state does not trigger a re-render.
      return initialVerificationState

    case 'settled':
      return { ...action.outcome, value: action.value }
  }
}
