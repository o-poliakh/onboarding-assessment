import { z } from 'zod'

const envSchema = z.object({
  VITE_API_BASE_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
})

export function parseEnv(source: unknown) {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`)
  }

  return {
    apiBaseUrl: result.data.VITE_API_BASE_URL,
  } as const
}

/** Validated application configuration. Fails fast at startup when misconfigured. */
export const env = parseEnv(import.meta.env)
