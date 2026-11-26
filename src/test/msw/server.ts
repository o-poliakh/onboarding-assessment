import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/**
 * Shared MSW server for all tests.
 * Starts with the happy-path handlers; `server.resetHandlers()` in setup
 * drops per-test overrides added with `server.use(...)` after each test.
 */
export const server = setupServer(...handlers)
