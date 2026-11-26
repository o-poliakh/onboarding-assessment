import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { z } from 'zod'

const NAME_MAX_LENGTH = 50

/** "+1" followed by 10 digits: no spaces, dashes, parentheses or other characters. */
const CANADIAN_PHONE_FORMAT = /^\+1\d{10}$/
const CORPORATION_NUMBER_FORMAT = /^\d{9}$/

const validationMessages = {
  firstNameRequired: 'First name is required',
  firstNameTooLong: `First name must be ${NAME_MAX_LENGTH} characters or fewer`,
  lastNameRequired: 'Last name is required',
  lastNameTooLong: `Last name must be ${NAME_MAX_LENGTH} characters or fewer`,
  phoneRequired: 'Phone number is required',
  phoneFormat: 'Phone number must start with +1 followed by 10 digits',
  phoneNotCanadian: 'Enter a valid Canadian phone number',
  corporationNumberRequired: 'Corporation number is required',
  corporationNumberFormat: 'Corporation number must be 9 digits',
} as const

/**
 * `+1` is shared by the whole North American Numbering Plan, so the format check
 * alone also accepts US numbers. The parsed country must be Canada.
 * Runs only after the format regex has passed (it aborts on failure).
 */
function isCanadianPhoneNumber(value: string): boolean {
  const phoneNumber = parsePhoneNumberFromString(value)

  return phoneNumber?.country === 'CA' && phoneNumber.isValid()
}

function nameSchema(requiredMessage: string, tooLongMessage: string) {
  return z
    .string()
    .trim()
    .min(1, { error: requiredMessage, abort: true })
    .max(NAME_MAX_LENGTH, tooLongMessage)
}

// Surrounding whitespace is trimmed in every field: values pasted from elsewhere often carry it.
// Inner spaces are still rejected by the format checks.
const phoneSchema = z
  .string()
  .trim()
  .min(1, { error: validationMessages.phoneRequired, abort: true })
  .regex(CANADIAN_PHONE_FORMAT, { error: validationMessages.phoneFormat, abort: true })
  .refine(isCanadianPhoneNumber, validationMessages.phoneNotCanadian)

/** Exported separately: the async check reuses it to avoid requests for malformed numbers. */
export const corporationNumberSchema = z
  .string()
  .trim()
  .min(1, { error: validationMessages.corporationNumberRequired, abort: true })
  .regex(CORPORATION_NUMBER_FORMAT, validationMessages.corporationNumberFormat)

export const onboardingSchema = z.object({
  firstName: nameSchema(validationMessages.firstNameRequired, validationMessages.firstNameTooLong),
  lastName: nameSchema(validationMessages.lastNameRequired, validationMessages.lastNameTooLong),
  phone: phoneSchema,
  corporationNumber: corporationNumberSchema,
})

/** Raw values as typed by the user. */
export type OnboardingFormValues = z.input<typeof onboardingSchema>

/** Normalized values that are sent to the API. */
export type OnboardingData = z.output<typeof onboardingSchema>
