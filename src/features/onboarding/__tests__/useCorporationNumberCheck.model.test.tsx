import { act, renderHook } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import { checkCorporationNumber, type CorporationNumberCheckResult } from '../api/onboarding.api'
import { ApiError } from '../api/onboarding.errors'
import { useCorporationNumberCheck } from '../hooks/useCorporationNumberCheck'
import type {
  CorporationNumberVerificationResult,
  CorporationNumberVerificationState,
} from '../model/corporation-number.types'

/**
 * Model-based check of the hook: random sequences of checks, invalidations and
 * server responses (in any order, including responses that arrive after the request was
 * aborted), with invariants asserted after every step. A failure prints the seed and the steps.
 *
 * The API function is replaced (not the network) to control exactly when each request settles.
 */
vi.mock('../api/onboarding.api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/onboarding.api')>()),
  checkCorporationNumber: vi.fn(),
}))

const SEEDS = 150
const STEPS = 30

/** Raw inputs and the value the hook must request for each (null: malformed, no request). */
const INPUTS = [
  { raw: '111111111', value: '111111111' },
  { raw: ' 111111111 ', value: '111111111' },
  { raw: '222222222', value: '222222222' },
  { raw: '333333333', value: '333333333' },
  { raw: '12345', value: null },
] as const

/** The server's final answer for each value; any request may also fail technically. */
const ANSWERS: Record<string, CorporationNumberCheckResult> = {
  '111111111': { valid: true },
  '222222222': { valid: false, message: 'Invalid corporation number' },
  '333333333': { valid: true },
}

type FakeRequest = {
  value: string
  signal: AbortSignal
  settled: boolean
  settle: (outcome: 'answer' | 'timeout' | 'failure') => void
}

type CheckRecord = {
  step: number
  value: string | null
  /** Changes on invalidate and on a check of another value; a result is "current" within one. */
  epoch: number
  result?: CorporationNumberVerificationResult
  asserted: boolean
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fake API. Some requests ignore abort, like a response already being read when it happens. */
function installFakeApi(random: () => number) {
  const requests: FakeRequest[] = []
  vi.mocked(checkCorporationNumber).mockImplementation(
    (value, signal) =>
      new Promise((resolve, reject) => {
        const request: FakeRequest = {
          value,
          signal: signal!,
          settled: false,
          settle(outcome) {
            if (request.settled) return
            request.settled = true
            if (outcome === 'answer') resolve(ANSWERS[value]!)
            else if (outcome === 'timeout') reject(new ApiError('timeout', 'Request timed out'))
            else reject(new ApiError('http_error', 'Unexpected response status 500'))
          },
        }
        const honoursAbort = random() < 0.6
        signal?.addEventListener('abort', () => {
          if (honoursAbort && !request.settled) {
            request.settled = true
            reject(signal.reason)
          }
        })
        requests.push(request)
      }),
  )
  return requests
}

/** Whether a final status (and message) is the server's answer for the value. */
function isServerAnswer(value: string, result: { status: string; message?: string }) {
  const answer = ANSWERS[value]!
  return answer.valid
    ? result.status === 'valid'
    : result.status === 'invalid' && result.message === answer.message
}

function flush() {
  return act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

async function runSequence(seed: number): Promise<string[]> {
  const random = mulberry32(seed)
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!
  const requests = installFakeApi(random)
  const hook = renderHook(() => useCorporationNumberCheck())
  const trace: string[] = []
  const checks: CheckRecord[] = []
  /** Extra or missing requests: recorded, but the sequence goes on to reach the other invariants. */
  const requestCountViolations: string[] = []

  let epoch = 0
  /** The value of the latest check since the last invalidate, as the form relies on. */
  let latest: string | null = null

  const inFlight = () => requests.filter((r) => !r.settled && !r.signal.aborted)
  const state = (): CorporationNumberVerificationState => hook.result.current.state
  const fail = (message: string) => {
    throw new Error(
      `seed ${seed}: ${message}\nsteps:\n  ${trace.join('\n  ')}\nstate: ${JSON.stringify(state())}`,
    )
  }

  function assertInvariants() {
    const flying = inFlight()
    // At most one live request at a time.
    if (flying.length > 1) fail(`${flying.length} requests in flight`)

    const current = state()
    // The state always describes the latest checked value (or is idle after invalidate).
    if (latest === null) {
      if (current.status !== 'idle') fail('state is not idle after invalidate')
    } else if (current.status === 'idle' || current.value !== latest) {
      fail(`state does not describe the latest checked value ${latest}`)
    }
    // Pending means a live request for that value exists; a final state is the server's answer.
    if (current.status === 'pending' && flying[0]?.value !== current.value) {
      fail('state is pending without a live request for its value')
    }
    if (
      (current.status === 'valid' || current.status === 'invalid') &&
      !isServerAnswer(current.value, current)
    ) {
      fail(`state ${current.status} is not the server's answer for ${current.value}`)
    }

    for (const record of checks) {
      if (record.result === undefined || record.asserted) continue
      record.asserted = true
      const { result } = record
      // A check never returns a wrong final answer.
      if (record.value === null) {
        if (result.status !== 'skipped') fail(`malformed check returned ${result.status}`)
        continue
      }
      if (result.status === 'skipped') fail('well-formed check was skipped')
      if (
        (result.status === 'valid' || result.status === 'invalid') &&
        !isServerAnswer(record.value, result)
      ) {
        fail(`check@${record.step} returned a wrong ${result.status} for ${record.value}`)
      }
      // A check that stopped being current before it finished reports that, not an outcome.
      if (record.epoch !== epoch) {
        if (result.status !== 'aborted') {
          fail(`check@${record.step} was superseded but returned ${result.status}`)
        }
        continue
      }
      // The result of a still-current check agrees with the state (which is never "aborted").
      if (current.status !== result.status || current.value !== record.value) {
        fail(`check@${record.step} returned ${result.status} but state is ${current.status}`)
      }
    }
  }

  for (let step = 0; step < STEPS; step += 1) {
    const roll = random()
    if (roll < 0.45) {
      const input = pick(INPUTS)
      const before = requests.length
      const record: CheckRecord = { step, value: input.value, epoch, asserted: false }
      if (input.value !== null && input.value !== latest) {
        epoch += 1
        record.epoch = epoch
      }
      const reusable = input.value !== null && input.value === latest && state().status !== 'error'
      if (input.value !== null) latest = input.value
      trace.push(`${step}: check(${JSON.stringify(input.raw)})`)
      let promise!: Promise<CorporationNumberVerificationResult>
      act(() => {
        promise = hook.result.current.check(input.raw)
      })
      void promise.then((result) => {
        record.result = result
      })
      checks.push(record)
      const created = requests.length - before
      // Malformed or reusable: no request. Otherwise exactly one for the normalized value.
      if (input.value === null || reusable) {
        if (created !== 0) {
          requestCountViolations.push(`check(${input.raw}) sent ${created} requests, expected none`)
        }
      } else if (created !== 1 || requests.at(-1)?.value !== input.value) {
        requestCountViolations.push(
          `check(${input.raw}) sent ${created} requests, expected one for ${input.value}`,
        )
      }
    } else if (roll < 0.6) {
      trace.push(`${step}: invalidate()`)
      epoch += 1
      latest = null
      act(() => hook.result.current.invalidate())
    } else {
      // Any unsettled request may answer, including one aborted but still being read.
      const pending = requests.filter((r) => !r.settled)
      if (pending.length === 0) {
        trace.push(`${step}: (nothing to settle)`)
      } else {
        const request = pick(pending)
        const outcome = pick(['answer', 'answer', 'timeout', 'failure'] as const)
        trace.push(
          `${step}: settle #${requests.indexOf(request)} (${request.value}${request.signal.aborted ? ', aborted' : ''}) → ${outcome}`,
        )
        request.settle(outcome)
      }
    }
    await flush()
    assertInvariants()
  }

  // Unmount aborts the live request; every check promise must still settle, as aborted.
  const pendingAtUnmount = checks.filter((record) => record.result === undefined)
  hook.unmount()
  for (const request of requests) request.settle('answer')
  await flush()
  if (inFlight().length > 0) fail('a request is still live after unmount')
  const unsettled = checks.filter((record) => record.result === undefined)
  if (unsettled.length > 0) fail(`check@${unsettled[0]!.step} never settled`)
  for (const record of pendingAtUnmount) {
    if (record.result?.status !== 'aborted') {
      fail(`check@${record.step} pending at unmount returned ${record.result?.status}`)
    }
  }
  return requestCountViolations
}

describe('useCorporationNumberCheck model', () => {
  it(`holds every invariant over ${SEEDS} random sequences`, async () => {
    const failures: string[] = []
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      vi.mocked(checkCorporationNumber).mockReset()
      try {
        const violations = await runSequence(seed)
        failures.push(...violations.map((violation) => `seed ${seed}: ${violation}`))
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (failures.length > 0) {
      const kinds = new Map<string, number>()
      for (const failure of failures) {
        const kind = failure
          .split('\n')[0]!
          .replace(/^seed \d+: /, '')
          .replace(/[\d"]+/g, '#')
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      }
      const summary = [...kinds].map(([kind, count]) => `${count}× ${kind}`).join('\n  ')
      throw new Error(
        `${failures.length} invariant violations in ${SEEDS} sequences:\n  ${summary}\n\nfirst:\n${failures[0]}`,
      )
    }
  }, 60_000)
})
