import { http, HttpResponse } from 'msw/http'
import { env } from '../../config/env'
import corporationInvalid from '../fixtures/corporation-invalid.json'
import corporationValid from '../fixtures/corporation-valid.json'
import profileDetailsMissingFields from '../fixtures/profile-details-missing-fields.json'

export const apiUrl = {
  corporationNumber: `${env.apiBaseUrl}/corporation-number/:number`,
  profileDetails: `${env.apiBaseUrl}/profile-details`,
} as const

const REQUIRED_PROFILE_FIELDS = ['firstName', 'lastName', 'phone', 'corporationNumber'] as const

function hasRequiredProfileFields(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  const record = body as Record<string, unknown>

  return REQUIRED_PROFILE_FIELDS.every(
    (field) => typeof record[field] === 'string' && record[field] !== '',
  )
}

/**
 * Default handlers reproduce the observed API contract for the happy path:
 * - only the fixture corporation number is valid, any other number gets 404 (as the real API does);
 * - POST succeeds with an empty 200 only when all required fields are present.
 *
 * Negative scenarios override these per test via `server.use(...)`.
 * Exact payload checks belong to test assertions, not to these handlers.
 */
export const handlers = [
  http.get(apiUrl.corporationNumber, ({ params }) => {
    if (params.number === corporationValid.corporationNumber) {
      return HttpResponse.json(corporationValid, { status: 200 })
    }

    return HttpResponse.json(corporationInvalid, { status: 404 })
  }),

  http.post(apiUrl.profileDetails, async ({ request }) => {
    const body: unknown = await request.json().catch(() => null)

    if (!hasRequiredProfileFields(body)) {
      return HttpResponse.json(profileDetailsMissingFields, { status: 400 })
    }

    return new HttpResponse(null, { status: 200 })
  }),
]
