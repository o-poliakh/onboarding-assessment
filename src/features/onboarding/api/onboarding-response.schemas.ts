import { z } from 'zod'

/** Server messages are shown to the user as plain text, so their length is bounded. */
const serverMessage = z.string().trim().min(1).max(300)

/** GET /corporation-number/:number → 200 */
export const corporationNumberValidResponseSchema = z.object({
  corporationNumber: z.string(),
  valid: z.literal(true),
})

/** GET /corporation-number/:number → 404 */
export const corporationNumberInvalidResponseSchema = z.object({
  valid: z.literal(false),
  message: serverMessage,
})

/** POST /profile-details → 400 */
export const profileDetailsErrorResponseSchema = z.object({
  message: serverMessage,
})
