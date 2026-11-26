/** Why a verification could not be completed. UI text is chosen by the presentation layer. */
export type VerificationErrorType = 'timeout' | 'unavailable'

/** What a finished verification request produced: the server's answer or a technical error. */
export type VerificationOutcome =
  | { status: 'valid' }
  | { status: 'invalid'; message: string }
  | { status: 'error'; errorType: VerificationErrorType }

/** State of the remote corporation number verification, tied to the value it was made for. */
export type CorporationNumberVerificationState =
  | { status: 'idle' }
  | { status: 'pending'; value: string }
  | (VerificationOutcome & { value: string })

export type CorporationNumberVerificationAction =
  | { type: 'started'; value: string }
  /** Only for the current request: the hook never dispatches results of replaced requests. */
  | { type: 'settled'; value: string; outcome: VerificationOutcome }
  | { type: 'invalidated' }

/** Outcome returned to callers that await a verification (e.g. submit). */
export type CorporationNumberVerificationResult =
  | VerificationOutcome
  /** The value is locally malformed, so no request was made. */
  | { status: 'skipped' }
  /** The verification was superseded or cancelled before it finished. */
  | { status: 'aborted' }
