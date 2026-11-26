/**
 * Technical failures of the onboarding API. Expected business outcomes
 * (an invalid corporation number, a rejected submission) are regular results,
 * not errors. Intentional cancellation surfaces as the native `AbortError`.
 */
export type ApiErrorType = 'http_error' | 'network_error' | 'invalid_response' | 'timeout'

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly type: ApiErrorType
  readonly status: number | undefined

  constructor(
    type: ApiErrorType,
    message: string,
    options: { status?: number | undefined; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.type = type
    this.status = options.status
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof ApiError && error.type === 'timeout'
}
