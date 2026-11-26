# Technical notes

The reasoning behind the [README](../README.md): requirements coverage, architecture details, observability, the API contract, the testing approach, assumptions and trade-offs. Setup, scripts, project structure, known limitations and next steps are in the README.

## Requirements coverage

Every requirement from the task, where it is implemented, and the tests that prove it.

| Requirement                                                    | Implementation                                                                                              | Tests                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| First and last name, required, at most 50 characters           | `nameSchema` in `model/onboarding-form.schema.ts`                                                           | Schema: length and whitespace-only cases. Form: empty fields on submit                                  |
| Canadian phone number, starts with `+1`, no special characters | `phoneSchema`: format regex, then the parsed number must belong to `CA`                                     | Schema: `phone` block. Form: a US `+1` number is rejected on blur                                       |
| Corporation number: 9 characters, verified with `GET`          | `corporationNumberSchema`, `useCorporationNumberCheck`, `verifyCorporationNumber`, `checkCorporationNumber` | Form: verification tests. Hook: contract and random-sequence tests. API: `checkCorporationNumber` block |
| Valid corporation numbers are not hardcoded                    | The API is the only source of truth. One fixture number comes from the real API                             | MSW handlers answer `404` for every other number                                                        |
| All fields required; validation on blur, including the API     | `mode: 'onBlur'`, `onBlur` → `verification.check`                                                           | Form: nothing is validated or requested while typing                                                    |
| Submit shows a message under each missing field                | `handleSubmit` + Zod resolver, focus on the first invalid field                                             | Form: empty fields on submit, nothing is sent                                                           |
| Valid values are sent with `POST /profile-details`             | `submitProfileDetails`                                                                                      | Form: happy path. API: the JSON body                                                                    |
| `200` means success; `400` returns a message                   | `<output>` for success, `role="alert"` for the message                                                      | Form: a rejected submission and a retry. API: the `400` message                                         |
| TypeScript, React hooks including custom hooks                 | Strict TypeScript, `useCorporationNumberCheck`                                                              | Through the form, the hook's only client, and the hook's own contract tests                             |
| Integration tests for essential parts (React Testing Library)  | `OnboardingForm.test.tsx`: real components, only the network is mocked                                      | See [Testing](#testing)                                                                                 |
| Validation schema library, Vite, optional linter               | Zod, Vite, Oxlint (see [Trade-offs](#trade-offs))                                                           | `npm run lint` in CI                                                                                    |
| Code in a git repository, ready for PR review                  | GitHub, CI on every pull request                                                                            | `.github/workflows/ci.yml`                                                                              |

## Architecture

Project structure, the data flow diagram and state ownership are in the [README](../README.md#architecture). This section covers the parts that need an explanation.

### Remote errors stay out of React Hook Form

The corporation number field shows the local error first (for example "must be 9 digits"). If there is none, it shows the remote verification result. The remote error is derived from the reducer state and **not** copied into React Hook Form with `setError`, because the next resolver run would wipe it.

### Trust boundary

Client-side validation exists for UX: fast feedback and no pointless requests. Anyone can change or skip it, so the backend has the final say. It validates `POST /profile-details` on its own, and it must check the corporation number again. The frontend never treats its own checks as authorization.

### Corporation number verification

`useCorporationNumberCheck` returns `{ state, check(value), invalidate() }`.

- **On blur**, `check` runs. A value that fails the local format check never triggers a request. The trimmed value is requested and cached, so a pasted `" 826417395 "` and the submitted `"826417395"` share one verification.
- **On change**, `invalidate` aborts the request in flight and forgets the previous result. Without this, going A → B → A would reuse the stale result for A.
- **One current verification.** The hook keeps a single ref: the verification of the current value, in flight or settled with a final answer. Its promise is also the cache. Checking another value replaces it, so `state` and the result of the latest `check` always describe the same value, even for a caller that skips `invalidate`.
- **Deduplication.** A request for the same value that is already in flight returns the same promise. A final result (valid or invalid) is reused. A technical error is retried on the next check.
- **Stale responses.** A response is applied only if its `AbortController` is the current one. Comparing controllers rather than values also tells apart two requests for the same number.
- **Response mapping.** `verifyCorporationNumber` turns the API result and its errors into an outcome (`valid`, `invalid` or `error`) and never rejects. The hook relies on that and has no fallback of its own, so the guarantee lives in one place.
- **Hook and reducer contract.** The hook owns the request lifecycle and request identity. The reducer only describes state transitions and receives only current results, so it does not repeat the hook's check. The form tests cover this through behavior: editing while a check is pending, the check for a previous number being cancelled, and the same number entered again. In the form an edit always aborts the previous request, so a late response cannot reach it; the hook's own tests settle replaced requests directly and also cover sequences the form never produces.

### Submit flow

`useProfileSubmission` owns the flow below; `OnboardingForm` only wires it to the form and renders its state.

1. A synchronous `useRef` guard blocks a second submit before React has re-rendered.
2. The Zod resolver validates every field. The first invalid field gets focus and the page title gets an `Error: ` prefix.
3. The form awaits the corporation number verification, reusing a request in flight or a stored result. If the number is not valid, nothing is posted and focus moves to that field.
4. The trimmed data is sent with `POST`. While this runs, fields are read-only and the button is locked with `aria-disabled`.
5. On `200`, the success message appears in an `<output>` (implicit `role="status"`). On `400`, the server message appears in a `role="alert"` above the button.
6. After a success, Submit stays locked until the user edits a field. The guard blocks clicks, Enter and programmatic submits. Both guards are refs, set together with the state they mirror, so a submit handled before React re-renders is blocked too. The API has no idempotency key, so posting again would create a duplicate.

Submit calls `preventDefault` on `mousedown`, so the focused field does not blur. Otherwise the blur would show or clear that field's error, the button would move, and a click could end outside it and never fire. Submit validates every field anyway.

### Accessibility

- Every field has a visible `<label>`. Errors are linked with `aria-describedby`, and fields are marked with `aria-invalid`.
- Focus moves to the first invalid field on submit.
- Submit is locked with `aria-disabled`, not `disabled`. A disabled button that has focus drops it to `<body>`, so a keyboard user would lose their place after every submit. The submit handler's guards do the actual blocking.
- After a failed submit, the page title starts with `Error: ` so a screen reader announces the problem first (a GOV.UK pattern). The prefix disappears once every field error is fixed. A message from the server stays, with the prefix, until the next submit: only the server can say that it no longer applies.
- Fields use semantic input types and autofill hints: `type="tel"`, `inputMode="numeric"`, `autocomplete="given-name"`, `"family-name"`, `"tel"`.
- `noValidate` turns off native validation bubbles. Focus styles are visible, animations respect `prefers-reduced-motion`, and narrow screens get one column.

## Observability

Every technical error goes through **one function**, `reportError(error, context)` in `src/observability/reportError.ts`. For now it writes to the browser console. A monitoring service (Sentry, Datadog, …) would be called inside it, with no changes at the call sites. There is deliberately no pluggable reporter API: with one destination it would be an extension point nobody uses.

| Source                | Where it is hooked                                    | Context                                            |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `api`                 | `requestWithTimeout` in `onboarding.api.ts`           | `endpoint` (route template), `errorType`, `status` |
| `react-caught`        | `createRoot` `onCaughtError` (the boundary caught it) | `componentStack`                                   |
| `react-uncaught`      | `createRoot` `onUncaughtError`                        | `componentStack`                                   |
| `react-recoverable`   | `createRoot` `onRecoverableError`                     | `componentStack`                                   |
| `window-error`        | `window` `error` event                                | none                                               |
| `unhandled-rejection` | `window` `unhandledrejection` event                   | none                                               |

- **What the API layer reports.** Technical failures only: timeouts, network errors, unexpected statuses and `invalid_response`, which means the backend contract changed. Business outcomes (an invalid number, a `400`) and requests cancelled by the user are not reported.
- **No personal data.** Reports carry a route template (`GET /corporation-number/:number`), never the real URL or any body. Error messages are written by our code and contain no user input. A JSON parse error is not attached as `cause`, because its message quotes the start of the body.
- **Error boundary.** A render error replaces the form with "Something went wrong" and a **Reload page** button. A reload rather than a re-render, because a render bug would fail again, while a reload also picks up a fixed deployment. The step indicator stays. The error is reported once, through `onCaughtError`.
- **In tests**, a spy on `console.error` records the reports (`src/test/errorReports.ts`), so tests can assert on what was reported.

Not covered: errors while modules load (for example an invalid `VITE_API_BASE_URL`) happen before any handler is installed. They still appear in the console, and they are deployment errors, not runtime ones.

## API contract

Base URL: `VITE_API_BASE_URL`. The status codes below were confirmed against the real QA API. Every response body the app reads is validated with Zod (`api/onboarding-response.schemas.ts`).

### `GET /corporation-number/:number`

| Status | Body                                                          | Result                                  |
| ------ | ------------------------------------------------------------- | --------------------------------------- |
| 200    | `{ "corporationNumber": "826417395", "valid": true }`         | Valid                                   |
| 404    | `{ "valid": false, "message": "Invalid corporation number" }` | Invalid (message shown under the field) |

Anything else is a technical error, shown as a retryable message under the field. That includes `200` with `valid: false` or a different number, a 5xx (even with a `valid: false` body), an unexpected body, malformed JSON, a network failure and a timeout.

### `POST /profile-details`

```json
{
  "firstName": "Hello",
  "lastName": "World",
  "phone": "+13062776103",
  "corporationNumber": "826417395"
}
```

| Status | Body                                                                                | Result                                |
| ------ | ----------------------------------------------------------------------------------- | ------------------------------------- |
| 200    | none                                                                                | Success (the body is not read)        |
| 400    | `{ "message": "Invalid phone number" }`, `{ "message": "Missing required fields" }` | Server message shown above the button |

Other statuses, malformed bodies and network failures show a generic error.

### Timeouts and retries

- Every request has a **10 s timeout** that also covers reading the response body.
- A request cancelled by the user (a changed value or an unmount) is aborted silently. A timeout is shown to the user.
- `GET` is retried on the next blur or submit after a technical error.
- `POST` is **never retried automatically**. After a timeout the outcome on the server is unknown, so the user sees: _"The request timed out. Your details may already have been submitted. Please check before submitting again."_

## Testing

The test layers and commands are in the [README](../README.md#testing). These are the rules the tests follow:

- **Fixtures** in `src/test/fixtures` are snapshots of real API responses. The default MSW handlers mirror the observed contract: only the fixture number is valid, other numbers get a `404`, and `POST` succeeds only with every field present. Tests override them with `server.use(...)`.
- **Strict network boundary.** With only `onUnhandledFrame: 'error'`, MSW fails an unhandled request with a network error, which the app handles, so a test with a wrong URL could still pass. `setup.ts` therefore fails every test that made an unhandled request.
- **No real-time waits.** Tests use responses that resolve when the test says so, and fake timers. "No request was sent" and "a late response changed nothing" are checked after `settleNetwork()`, which runs every timer due within half the request timeout. A real sleep would miss a delayed call, such as a debounce or a retry.
- **`fireEvent` only where user-event cannot reach.** It is used for two submits in one task, a programmatic submit after a success, and a value changed and left in one task. Each such test asserts the `POST` count, and that a blocked submit was cancelled, because otherwise the browser falls back to a native submission that puts the details in the URL.
- **Behavior, not implementation.** Tests check what the user sees and which requests reach the network. Expected messages are written out rather than imported from the code, so a wrong message fails a test.
- **Random sequences for the verification hook.** `useCorporationNumberCheck.model.test.tsx` runs 150 seeded sequences of checks, invalidations and responses in any order, including a response that arrives after its request was aborted. After every step it asserts the invariants: at most one live request, the state describes the latest checked value, no wrong final answer, a superseded or cancelled check returns `aborted`, and every promise settles. A failure prints the seed and the steps. This test replaces one function instead of the network, to control exactly when each request settles.

### Mutation testing

`npm run test:mutation` runs [StrykerJS](https://stryker-mutator.io/) and scores about **94%** (94.24% of 402 mutants). The score is a guide, not a goal: no test exists only to kill a mutant.

The surviving mutants change nothing a user or the API can observe: diagnostic messages, defaults that equal the mutated value (the `GET` method, empty default values, the boundary's initial state, hook dependency arrays), a submission error `type` the form never compares (`'server'`), checks already guaranteed by another check, and cleanup with no visible effect. One mutant is genuinely untested: `location.reload()`, which jsdom can neither run nor spy on.

Stryker does not mutate string JSX attributes such as `autoComplete`, `type` and `inputMode`, so the _input affordances_ test is their only protection (WCAG 1.3.5). The report is written to `reports/mutation/index.html`.

## Assumptions

The task leaves these points open:

- **The corporation number is digits only.** The task says "9 chars", but every valid example is numeric and the value goes into the URL.
- **Every field is trimmed.** A value made only of spaces counts as empty, and trimmed values are sent. Spaces inside a number are still rejected.
- **Phone validation is strict.** No spaces, dashes or parentheses, and the number must belong to Canada, because US numbers also start with `+1`. Toll-free numbers (`800`, `888`, …) are shared by every `+1` country, so they are rejected.
- **Current browsers only.** Request cancellation combined with the timeout uses `AbortSignal.any`, which needs Safari 17.4 or later. Older browsers would need a small fallback that links the two signals by hand.
- **The design is followed exactly**, to within about 1px of the mockup. One deliberate difference: a field with an error gets a red border. Messages that are not in the mockup (success, server error, verification errors, the error fallback) reuse its typography and colors.
- **The verification error shows the server text** ("Invalid corporation number"), although the mockup uses different capitalization.
- **No pending indicator** while the corporation number is verified, because the design has none.
- **The form is not reset after a successful submit**, so the user can still see what was sent.

## Trade-offs

- **React Hook Form + Zod instead of hand-written state, Formik or TanStack Form.** One typed schema drives the form's input and output types, and the verification hook reuses its corporation number rule. React Hook Form keeps inputs uncontrolled and provides the blur and submit modes. Formik is heavier and less actively maintained; TanStack Form has a smaller ecosystem.
- **Validation messages live next to the rules.** With one language and one schema, a separate message layer adds indirection without a second reason to change. If i18n is needed, the schema should return error codes and the form should translate them.
- **The request body lists its fields explicitly.** `submitProfileDetails` does not send the schema output as is, so a field added to the form for the UI only is not posted by accident. The cost: a new API field is added in two places, and the API test fails if one is missed.
- **No error summary.** GOV.UK recommends one for long forms. With four fields on one card, every error is already under its field and focus moves to the first one, so a summary would only repeat them and shift the layout.
- **A custom hook with `useReducer` instead of TanStack Query or XState.** Five explicit states, cancellation and deduplication fit in a small reducer without extra dependencies, at the cost of writing and testing that logic ourselves.
- **Endpoint-specific API functions instead of a generic client or Axios.** Each endpoint has its own status semantics (`404` = invalid, `400` = rejected). Two explicit functions are easier to review than an abstraction built for two calls.
- **A `setTimeout`-based timeout instead of `AbortSignal.timeout()`.** Fake timers cannot control the native timeout in Node, and the manual version keeps the timeout tests fast and deterministic.
- **Validation on blur instead of on every keystroke.** This follows the task literally. `mode: 'onTouched'` ("reward early, punish late") would clear errors as the user types.
- **A small class error boundary instead of `react-error-boundary`.** There is one boundary and it needs no reset, so the library's main features (`resetKeys`, `showBoundary`) would go unused.
- **Oxlint instead of ESLint.** It is much faster, and its rules (including React hooks and `jsx-a11y`) cover what this project needs.
- **Mockup colors over contrast.** The input border (`#d2d2d2`, 1.5:1) and error red (`#ea3323`, 4.2:1) are below the WCAG 2.2 minimums (3:1 for UI components, 4.5:1 for small text). They match the design as requested, and the CSS custom properties in `src/index.css` can be changed in one place.
- **Stryker skips its tsconfig rewriting step.** TypeScript 7 (native) no longer ships the JavaScript API Stryker uses for it, and our tsconfig files need no rewriting.
