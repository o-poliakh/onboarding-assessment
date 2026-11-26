import { delay, http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import corporationInvalid from '../../../test/fixtures/corporation-invalid.json'
import corporationValid from '../../../test/fixtures/corporation-valid.json'
import { apiUrl } from '../../../test/msw/handlers'
import { server } from '../../../test/msw/server'
import { REQUEST_TIMEOUT_MS } from '../api/onboarding.api'
import { verifyCorporationNumber } from '../api/verifyCorporationNumber'

const NUMBER = corporationValid.corporationNumber

afterEach(() => {
  vi.useRealTimers()
})

describe('verifyCorporationNumber', () => {
  it('maps a confirmed number to valid', async () => {
    await expect(verifyCorporationNumber(NUMBER, new AbortController().signal)).resolves.toEqual({
      status: 'valid',
    })
  })

  it('maps a rejected number to invalid with the server message', async () => {
    await expect(
      verifyCorporationNumber('111111111', new AbortController().signal),
    ).resolves.toEqual({ status: 'invalid', message: corporationInvalid.message })
  })

  it('maps a technical failure to an unavailable error instead of rejecting', async () => {
    server.use(http.get(apiUrl.corporationNumber, () => new HttpResponse(null, { status: 500 })))

    await expect(verifyCorporationNumber(NUMBER, new AbortController().signal)).resolves.toEqual({
      status: 'error',
      errorType: 'unavailable',
    })
  })

  it('maps a timeout to a timeout error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    server.use(
      http.get(apiUrl.corporationNumber, async () => {
        await delay('infinite')
        return HttpResponse.json(corporationValid)
      }),
    )

    const outcome = verifyCorporationNumber(NUMBER, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)

    await expect(outcome).resolves.toEqual({ status: 'error', errorType: 'timeout' })
  })

  it('resolves a cancelled request as an error instead of rejecting', async () => {
    server.use(
      http.get(apiUrl.corporationNumber, () => delay('infinite').then(() => new Response())),
    )
    const controller = new AbortController()

    const outcome = verifyCorporationNumber(NUMBER, controller.signal)
    controller.abort()

    await expect(outcome).resolves.toEqual({ status: 'error', errorType: 'unavailable' })
  })
})
