import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import corporationInvalid from '../../../test/fixtures/corporation-invalid.json'
import corporationValid from '../../../test/fixtures/corporation-valid.json'
import profileDetailsError from '../../../test/fixtures/profile-details-error.json'
import { apiUrl } from '../../../test/msw/handlers'
import { recordRequests } from '../../../test/msw/recordRequests'
import { reportedErrors } from '../../../test/errorReports'
import { server } from '../../../test/msw/server'
import {
  checkCorporationNumber,
  REQUEST_TIMEOUT_MS,
  submitProfileDetails,
} from '../api/onboarding.api'
import { ApiError, type ApiErrorType } from '../api/onboarding.errors'

const PROFILE = {
  firstName: 'Hello',
  lastName: 'World',
  phone: '+13062776103',
  corporationNumber: '826417395',
}

function respondToCorporationCheck(response: () => Response | Promise<Response>) {
  server.use(http.get(apiUrl.corporationNumber, response))
}

function respondToSubmit(response: () => Response | Promise<Response>) {
  server.use(http.post(apiUrl.profileDetails, response))
}

async function expectApiError(
  promise: Promise<unknown>,
  type: ApiErrorType,
  details: { status?: number } = {},
) {
  const error = await promise.catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ name: 'ApiError', type, ...details })
  return error as ApiError
}

/**
 * Stand-in for `fetch` whose response headers arrive but whose JSON body never completes.
 * Like real fetch, aborting the request signal errors the body stream. MSW is bypassed here
 * because aborting a half-streamed mocked socket trips an internal undici assertion.
 */
function fetchWithStalledBody(_input: RequestInfo | URL, init?: RequestInit) {
  const signal = init?.signal
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"valid":'))
      signal?.addEventListener('abort', () => {
        controller.error(signal.reason)
      })
    },
  })
  return Promise.resolve(
    new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('checkCorporationNumber', () => {
  it('returns valid for 200 with the same corporation number', async () => {
    await expect(checkCorporationNumber(corporationValid.corporationNumber)).resolves.toEqual({
      valid: true,
    })
  })

  it('returns invalid with the server message for 404 with valid: false', async () => {
    await expect(checkCorporationNumber('111111111')).resolves.toEqual({
      valid: false,
      message: corporationInvalid.message,
    })
  })

  it.each([
    [
      '200 with a different corporation number',
      () => HttpResponse.json({ ...corporationValid, corporationNumber: '123456789' }),
      200,
    ],
    ['200 with valid: false', () => HttpResponse.json(corporationInvalid, { status: 200 }), 200],
    [
      '404 with an unexpected body',
      () => HttpResponse.json({ error: 'Not Found' }, { status: 404 }),
      404,
    ],
    // Shown under the field otherwise: an empty error message.
    [
      '404 with a blank message',
      () => HttpResponse.json({ valid: false, message: '   ' }, { status: 404 }),
      404,
    ],
  ])('treats %s as a contract violation', async (_case, response, status) => {
    respondToCorporationCheck(response)
    await expectApiError(checkCorporationNumber('826417395'), 'invalid_response', { status })
  })

  it('treats malformed JSON as a contract violation', async () => {
    respondToCorporationCheck(
      () => new HttpResponse('{"valid":', { headers: { 'Content-Type': 'application/json' } }),
    )
    const error = await expectApiError(checkCorporationNumber('826417395'), 'invalid_response', {
      status: 200,
    })
    expect(error.cause).toBeUndefined()
  })

  it('does not turn a 500 into an invalid result, even with a matching body', async () => {
    respondToCorporationCheck(() => HttpResponse.json(corporationInvalid, { status: 500 }))
    const error = await checkCorporationNumber('111111111').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ type: 'http_error', status: 500 })
  })

  it('classifies a transport failure as a network error', async () => {
    respondToCorporationCheck(() => HttpResponse.error())
    const error = await expectApiError(checkCorporationNumber('826417395'), 'network_error')
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  it('rethrows intentional cancellation as AbortError, not as a technical failure', async () => {
    respondToCorporationCheck(async () => {
      await delay('infinite')
      return HttpResponse.json(corporationValid)
    })
    const controller = new AbortController()

    const request = checkCorporationNumber('826417395', controller.signal)
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })

  describe('timeout', () => {
    it('fails with a timeout when the server does not respond', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      respondToCorporationCheck(async () => {
        await delay('infinite')
        return HttpResponse.json(corporationValid)
      })

      const request = checkCorporationNumber('826417395', new AbortController().signal)
      const assertion = expectApiError(request, 'timeout')
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

      const error = await assertion
      expect(error.cause).toMatchObject({ name: 'TimeoutError' })
    })

    it('covers reading the response body, not only the headers', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchWithStalledBody)

      const request = checkCorporationNumber('826417395')
      const assertion = expectApiError(request, 'timeout')
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

      await assertion
    })
  })
})

describe('submitProfileDetails', () => {
  it('sends the profile as JSON and succeeds on 200 without a body', async () => {
    const requests = recordRequests()
    respondToSubmit(() => new HttpResponse(null, { status: 200 }))

    await expect(submitProfileDetails(PROFILE)).resolves.toEqual({ ok: true })

    const [request] = requests.matching('POST', /^\/profile-details$/)
    expect(request?.headers.get('Content-Type')).toBe('application/json')
    expect(await request?.json()).toEqual(PROFILE)
  })

  it('returns the server message for 400', async () => {
    respondToSubmit(() => HttpResponse.json(profileDetailsError, { status: 400 }))
    await expect(submitProfileDetails(PROFILE)).resolves.toEqual({
      ok: false,
      message: profileDetailsError.message,
    })
  })

  it('treats 400 with an unexpected body as a contract violation', async () => {
    respondToSubmit(() => HttpResponse.json({ errors: [] }, { status: 400 }))
    await expectApiError(submitProfileDetails(PROFILE), 'invalid_response')
  })

  it('classifies other statuses as HTTP errors', async () => {
    respondToSubmit(() => new HttpResponse(null, { status: 503 }))
    const error = await submitProfileDetails(PROFILE).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ type: 'http_error', status: 503 })
  })

  it('fails with a timeout and does not retry the POST', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let attempts = 0
    respondToSubmit(async () => {
      attempts += 1
      await delay('infinite')
      return new HttpResponse(null, { status: 200 })
    })

    const assertion = expectApiError(submitProfileDetails(PROFILE), 'timeout')
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 3)

    await assertion
    expect(attempts).toBe(1)
  })
})

describe('error reporting', () => {
  it('reports a technical failure with the endpoint template, never the corporation number', async () => {
    respondToCorporationCheck(() => new HttpResponse(null, { status: 500 }))

    const error = await expectApiError(
      checkCorporationNumber(PROFILE.corporationNumber),
      'http_error',
    )

    expect(reportedErrors()).toEqual([
      {
        error,
        context: {
          source: 'api',
          endpoint: 'GET /corporation-number/:number',
          errorType: 'http_error',
          status: 500,
        },
      },
    ])
    expect(JSON.stringify(reportedErrors()[0]?.context)).not.toContain(PROFILE.corporationNumber)
    expect(error.message).not.toContain(PROFILE.corporationNumber)
  })

  it('reports a failed submission without the profile details', async () => {
    respondToSubmit(() => HttpResponse.error())

    const error = await expectApiError(submitProfileDetails(PROFILE), 'network_error')

    expect(reportedErrors()).toEqual([
      {
        error,
        context: {
          source: 'api',
          endpoint: 'POST /profile-details',
          errorType: 'network_error',
          status: undefined,
        },
      },
    ])
    const report = JSON.stringify(reportedErrors()[0]?.context) + error.message
    for (const value of Object.values(PROFILE)) {
      expect(report).not.toContain(value)
    }
  })

  it('reports a malformed response without any part of its body', async () => {
    // A JSON parse error quotes the start of the body, which may echo personal data.
    const body = `${PROFILE.phone} is not a valid phone number`
    respondToSubmit(() => new HttpResponse(body, { status: 400 }))

    const error = await expectApiError(submitProfileDetails(PROFILE), 'invalid_response', {
      status: 400,
    })

    expect(reportedErrors()).toEqual([
      {
        error,
        context: {
          source: 'api',
          endpoint: 'POST /profile-details',
          errorType: 'invalid_response',
          status: 400,
        },
      },
    ])
    expect(error.cause).toBeUndefined()
    expect(error.message).not.toContain(body.slice(0, 4))
  })

  it('does not report business outcomes or intentional cancellation', async () => {
    await checkCorporationNumber(corporationValid.corporationNumber)
    await checkCorporationNumber('111111111')
    respondToSubmit(() => HttpResponse.json(profileDetailsError, { status: 400 }))
    await submitProfileDetails(PROFILE)

    respondToCorporationCheck(async () => {
      await delay('infinite')
      return HttpResponse.json(corporationValid)
    })
    const controller = new AbortController()
    const cancelled = checkCorporationNumber(PROFILE.corporationNumber, controller.signal)
    controller.abort()
    await cancelled.catch(() => {})

    expect(reportedErrors()).toEqual([])
  })
})
