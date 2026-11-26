import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { onboardingSchema, type OnboardingFormValues } from '../model/onboarding-form.schema'

const VALID_VALUES: OnboardingFormValues = {
  firstName: 'Hello',
  lastName: 'World',
  phone: '+13062776103',
  corporationNumber: '826417395',
}

function errorsFor(values: Partial<OnboardingFormValues>) {
  const result = onboardingSchema.safeParse({ ...VALID_VALUES, ...values })

  return result.success ? {} : z.flattenError(result.error).fieldErrors
}

describe('onboardingSchema', () => {
  it('accepts valid values', () => {
    expect(onboardingSchema.safeParse(VALID_VALUES).success).toBe(true)
  })

  // Every field is trimmed first, so a value made only of spaces counts as empty.
  it.each([
    ['firstName', 'First name is required'],
    ['lastName', 'Last name is required'],
    ['phone', 'Phone number is required'],
    ['corporationNumber', 'Corporation number is required'],
  ] as const)('treats whitespace-only %s as empty', (field, requiredMessage) => {
    expect(errorsFor({ [field]: '   ' })[field]).toEqual([requiredMessage])
  })

  describe.each([
    ['firstName', 'First name must be 50 characters or fewer'],
    ['lastName', 'Last name must be 50 characters or fewer'],
  ] as const)('%s', (field, tooLongMessage) => {
    it.each([1, 50])('accepts %i characters', (length) => {
      expect(errorsFor({ [field]: 'a'.repeat(length) })[field]).toBeUndefined()
    })

    it('rejects 51 characters', () => {
      expect(errorsFor({ [field]: 'a'.repeat(51) })[field]).toEqual([tooLongMessage])
    })

    it('trims surrounding whitespace before the length check and in the output', () => {
      const value = ` ${'a'.repeat(50)} `
      const result = onboardingSchema.parse({ ...VALID_VALUES, [field]: value })

      expect(result[field]).toBe('a'.repeat(50))
    })
  })

  describe('phone', () => {
    it.each(['+16045550123', '+14165551234', '+16135550123'])(
      'accepts Canadian number %s',
      (phone) => {
        expect(errorsFor({ phone }).phone).toBeUndefined()
      },
    )

    it.each([
      ['missing leading +', '13062776103'],
      ['spaces', '+1 306 277 6103'],
      ['parentheses and dashes', '+1(306)277-6103'],
      ['other country code', '+443062776103'],
      ['too short', '+1306277610'],
      ['too long', '+130627761030'],
      ['letters', '+1306277610a'],
      ['characters before +1', 'a+13062776103'],
    ])('rejects format: %s', (_case, phone) => {
      expect(errorsFor({ phone }).phone).toEqual([
        'Phone number must start with +1 followed by 10 digits',
      ])
    })

    it.each([
      ['US number sharing the +1 code', '+12025550123'],
      ['non-existent Canadian number', '+13061111111'],
      // Shared by every +1 country, so it cannot be shown to be Canadian (a documented assumption).
      ['toll-free number', '+18005551234'],
    ])('rejects %s', (_case, phone) => {
      expect(errorsFor({ phone }).phone).toEqual(['Enter a valid Canadian phone number'])
    })
  })

  describe('corporationNumber', () => {
    it.each([
      ['8 digits', '82641739'],
      ['10 digits', '8264173950'],
      ['non-digit characters', '82641739a'],
      ['inner whitespace', '826 417 395'],
    ])('rejects %s', (_case, corporationNumber) => {
      expect(errorsFor({ corporationNumber }).corporationNumber).toEqual([
        'Corporation number must be 9 digits',
      ])
    })
  })
})
