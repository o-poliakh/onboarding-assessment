import type { VerificationOutcome } from '../model/corporation-number.types'
import { checkCorporationNumber } from './onboarding.api'
import { isTimeoutError } from './onboarding.errors'

/**
 * Corporation number verification as a domain outcome. Never rejects: every failure, including
 * the AbortError of a cancelled request, becomes an `error` outcome. The caller decides whether
 * the outcome still matters.
 */
export async function verifyCorporationNumber(
  value: string,
  signal: AbortSignal,
): Promise<VerificationOutcome> {
  try {
    const response = await checkCorporationNumber(value, signal)
    return response.valid ? { status: 'valid' } : { status: 'invalid', message: response.message }
  } catch (error) {
    return { status: 'error', errorType: isTimeoutError(error) ? 'timeout' : 'unavailable' }
  }
}
