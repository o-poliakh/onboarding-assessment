import { env } from '../../../config/env'
import { reportError } from '../../../observability/reportError'
import type { OnboardingData } from '../model/onboarding-form.schema'
import { ApiError } from './onboarding.errors'
import {
  corporationNumberInvalidResponseSchema,
  corporationNumberValidResponseSchema,
  profileDetailsErrorResponseSchema,
} from './onboarding-response.schemas'

export const REQUEST_TIMEOUT_MS = 10_000

export type CorporationNumberCheckResult = { valid: true } | { valid: false; message: string }

export type ProfileDetailsSubmitResult = { ok: true } | { ok: false; message: string }

type ApiRequest = {
  /**
   * Route template used in error reports, e.g. `GET /corporation-number/:number`.
   * The real URL is never reported: it contains the corporation number.
   */
  endpoint: string
  url: string
  init: RequestInit
}

/**
 * Runs a fetch with a timeout that also covers reading the response body.
 * The timeout is a `setTimeout`-based abort (not `AbortSignal.timeout`) so it can be
 * driven by fake timers in tests. Cancellation by the caller is rethrown as `AbortError`
 * and not reported; every other failure becomes a classified `ApiError` and is reported.
 */
async function requestWithTimeout<T>(
  { endpoint, url, init }: ApiRequest,
  cancellationSignal: AbortSignal | undefined,
  handleResponse: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => {
    timeoutController.abort(new DOMException('Request timed out', 'TimeoutError'))
  }, REQUEST_TIMEOUT_MS)
  const signal = cancellationSignal
    ? AbortSignal.any([cancellationSignal, timeoutController.signal])
    : timeoutController.signal

  try {
    const response = await fetch(url, { ...init, signal })
    return await handleResponse(response, signal)
  } catch (error) {
    if (!(error instanceof ApiError) && cancellationSignal?.aborted) {
      throw cancellationSignal.reason
    }
    const apiError = toApiError(error, timeoutController.signal.aborted)
    // Only technical values: the request and response bodies may contain personal data.
    reportError(apiError, {
      source: 'api',
      endpoint,
      errorType: apiError.type,
      status: apiError.status,
    })
    throw apiError
  } finally {
    clearTimeout(timer)
  }
}

function toApiError(error: unknown, timedOut: boolean): ApiError {
  if (error instanceof ApiError) {
    return error
  }
  if (timedOut) {
    return new ApiError('timeout', 'Request timed out', { cause: error })
  }
  return new ApiError('network_error', 'Network request failed', { cause: error })
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    // An abort while reading the body is a timeout or cancellation, not a malformed response.
    if (signal.aborted) {
      throw error
    }
    // No `cause`: a JSON parse error quotes the start of the body, which may echo personal data.
    throw new ApiError('invalid_response', 'Response body is not valid JSON', {
      status: response.status,
    })
  }
}

function invalidResponse(response: Response, detail: string): ApiError {
  return new ApiError('invalid_response', detail, { status: response.status })
}

function unexpectedStatus(response: Response): ApiError {
  return new ApiError('http_error', `Unexpected response status ${response.status}`, {
    status: response.status,
  })
}

/**
 * GET /corporation-number/:number
 * 200 + `valid: true` for the same number → valid; 404 + `valid: false` → invalid.
 * Any other status/body combination is a technical failure.
 */
export function checkCorporationNumber(
  corporationNumber: string,
  signal?: AbortSignal,
): Promise<CorporationNumberCheckResult> {
  const url = `${env.apiBaseUrl}/corporation-number/${encodeURIComponent(corporationNumber)}`

  const request = { endpoint: 'GET /corporation-number/:number', url, init: { method: 'GET' } }

  return requestWithTimeout(request, signal, async (response, requestSignal) => {
    if (response.status === 200) {
      const body = corporationNumberValidResponseSchema.safeParse(
        await readJson(response, requestSignal),
      )
      if (!body.success || body.data.corporationNumber !== corporationNumber) {
        throw invalidResponse(response, 'Unexpected corporation number response')
      }
      return { valid: true }
    }

    if (response.status === 404) {
      const body = corporationNumberInvalidResponseSchema.safeParse(
        await readJson(response, requestSignal),
      )
      if (!body.success) {
        throw invalidResponse(response, 'Unexpected corporation number rejection response')
      }
      return { valid: false, message: body.data.message }
    }

    throw unexpectedStatus(response)
  })
}

/**
 * POST /profile-details
 * 200 → submitted (the body is not read); 400 + message → rejected by the server.
 * Never retried automatically: after a timeout the outcome on the server is unknown.
 */
export function submitProfileDetails(
  profileDetails: OnboardingData,
): Promise<ProfileDetailsSubmitResult> {
  // The wire format of POST /profile-details is listed here, not inherited from the form schema:
  // a field added to the form for the UI only is not sent until it is added here.
  const { firstName, lastName, phone, corporationNumber } = profileDetails
  const requestBody = { firstName, lastName, phone, corporationNumber }

  const request = {
    endpoint: 'POST /profile-details',
    url: `${env.apiBaseUrl}/profile-details`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    },
  }

  return requestWithTimeout(request, undefined, async (response, requestSignal) => {
    if (response.status === 200) {
      return { ok: true }
    }

    if (response.status === 400) {
      const body = profileDetailsErrorResponseSchema.safeParse(
        await readJson(response, requestSignal),
      )
      if (!body.success) {
        throw invalidResponse(response, 'Unexpected submission rejection response')
      }
      return { ok: false, message: body.data.message }
    }

    throw unexpectedStatus(response)
  })
}
