import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

describe('parseEnv', () => {
  it.each(['https://api.example.test', 'http://localhost:3000'])('accepts %s', (url) => {
    expect(parseEnv({ VITE_API_BASE_URL: url }).apiBaseUrl).toBe(url)
  })

  it('removes trailing slashes so paths can be appended safely', () => {
    expect(parseEnv({ VITE_API_BASE_URL: 'https://api.example.test///' }).apiBaseUrl).toBe(
      'https://api.example.test',
    )
  })

  it.each([
    ['a missing value', {}],
    ['a non-URL value', { VITE_API_BASE_URL: 'not a url' }],
    ['a non-HTTP protocol', { VITE_API_BASE_URL: 'ftp://api.example.test' }],
    ['a protocol that only ends with http', { VITE_API_BASE_URL: 'xhttp://api.example.test' }],
    ['a protocol that only starts with https', { VITE_API_BASE_URL: 'httpsx://api.example.test' }],
  ])('fails fast with a readable error for %s', (_case, source) => {
    expect(() => parseEnv(source)).toThrow(
      /Invalid environment configuration:[\s\S]*VITE_API_BASE_URL/,
    )
  })
})
