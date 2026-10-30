# Test strategy: orders-service

This document says what we test, at which level, and why. It is the reference for reviewing a pull request's tests: if a change adds risk, the matching row below says where the test should go.

## 1. Quality goals

In order of priority, the service must:

1. **Charge the right amount, exactly once.** Overcharging, undercharging or double charging costs money and trust.
2. **Never sell stock it does not have**, even when many customers check out at once.
3. **Stay correct when payments misbehaves.** Slow, failing or changed third-party APIs must not corrupt orders.
4. **Give clients clear, stable errors** so they can retry safely and show useful messages.

Performance, accessibility and visual design matter for a real shop. They are out of scope here (see §6) because the sibling projects cover them.

## 2. Risk analysis

Likelihood and impact are rated 1 (low) to 3 (high). Risk = L × I. The higher the risk, the more layers defend it.

| #   | Risk                                                    | L   | I   | Risk  | Mitigation (layer → test)                                                                                                  |
| --- | ------------------------------------------------------- | --- | --- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| R1  | Wrong total: rounding, coupon order, shipping threshold | 3   | 3   | **9** | Unit examples at every boundary · property invariants · mutation testing · 1 UI journey checks the displayed total         |
| R2  | Oversell under concurrent checkouts                     | 2   | 3   | **6** | Conditional `UPDATE … WHERE stock >= qty` · integration race test on real Postgres                                         |
| R3  | Double charge when a client or the service retries      | 2   | 3   | **6** | Idempotency-Key per request and per payment · integration tests for sequential and simultaneous retries · E2E replay check |
| R4  | Payments outage hangs or corrupts checkout              | 2   | 3   | **6** | Timeouts, bounded retries, backoff · MSW fault-injection tests · outage-then-retry integration test                        |
| R5  | Payments API changes without notice                     | 2   | 3   | **6** | Pact consumer contract · provider verification in the provider's pipeline · response schema validation in the client       |
| R6  | Illegal lifecycle change (ship a cancelled order)       | 2   | 2   | **4** | Exhaustive 20-case transition table · compare-and-set on status · ship/cancel race test                                    |
| R7  | Bad input accepted or reported unclearly                | 3   | 1   | **3** | Zod validation · integration tests for each error code                                                                     |
| R8  | Wiring/config broken in the deployed stack              | 1   | 3   | **3** | E2E smoke over real HTTP with the real payments service                                                                    |

## 3. Test levels

| Level                                            | Owns                                                                                                                 | Does **not** own                            | Dependencies                                        | Speed budget      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------- | ----------------- |
| **Unit** (`tests/unit`)                          | Pure rules: pricing, money, lifecycle, request fingerprinting                                                        | I/O of any kind                             | None                                                | Whole suite < 1 s |
| **Property** (`tests/unit/*.properties.test.ts`) | Invariants over the whole input space of pricing                                                                     | Specific expected values (examples do that) | None                                                | < 1 s             |
| **Integration** (`tests/integration`)            | HTTP contract of _our_ API, SQL, transactions, concurrency, error mapping; the payments client under fault injection | Third-party behaviour, browsers             | Real Postgres (Testcontainers), `FakePayments`, MSW | < 10 s            |
| **Contract** (`tests/contract`)                  | The request/response shape both services rely on                                                                     | Business behaviour of the provider          | Pact mock server / provider stand-in                | < 5 s             |
| **E2E** (`tests/e2e`)                            | The deployed system works: browser → API → DB → payments                                                             | Rules already proven below; edge cases      | The whole stack                                     | < 30 s            |

### Where does a new test go?

Ask, in order, and stop at the first "yes":

1. Can it be proven by calling a pure function? → **unit** (and ask whether a **property** states it better than examples).
2. Does it need SQL, transactions, HTTP routing or our error mapping? → **integration**.
3. Is it about what another service sends or accepts? → **contract**.
4. Does it only fail when the real pieces are deployed together, or is it a top-priority user journey? → **E2E**.

If a bug escapes, write the test at the lowest level that would have caught it, then ask why that level missed it.

## 4. Test data and environments

- **Postgres:** one container per test run; one database per test file (`createTestDatabase`), migrated and seeded. Tests assert on deltas (stock before/after), never on absolute values another test could change.
- **Builders:** `anOrderRequest()` and `aCartLine()` give valid defaults; a test only states the fields it is about.
- **Determinism:** clock and ids are injected in integration tests; property tests print a seed on failure so it can be replayed exactly.
- **E2E:** `scripts/start-stack.ts` starts a fresh Postgres container, the payments stand-in and the service. No shared environment, no leftover data, nothing to clean up.
- **Payment sandbox tokens:** `tok_visa` is approved, `tok_declined` is declined, the same convention as most payment providers.

## 5. Quality gates

A pull request can merge only when CI is green. Every gate is enforced by tooling:

| Gate                          | Threshold                                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| Typecheck, lint, format       | zero errors                                                        |
| Unit + integration            | all pass                                                           |
| Coverage                      | 100 % on `src/domain`; overall ratchet (lines 97 %, branches 92 %) |
| Mutation score (`src/domain`) | ≥ 90 %                                                             |
| Pact provider verification    | all interactions pass                                              |
| E2E                           | all pass (one retry allowed; a pass on retry is reported as flaky) |

Thresholds only go up. When a change raises coverage or mutation score, raise the gate in the same PR.

## 6. Out of scope, on purpose

| Not tested here                     | Why                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Load and soak behaviour             | Covered with k6 in a separate performance project; mixing it into PR CI would make the pipeline slow and noisy.             |
| Accessibility and visual regression | The storefront is a test fixture, not a product. The Playwright and Cypress starter projects show these techniques.         |
| Cross-browser matrix                | One engine is enough to prove wiring; the UI has no browser-specific code.                                                  |
| Refunds                             | Not implemented. Cancelling a paid order releases stock only; a real system would also refund (and need a contract for it). |
| Database migrations over time       | A single idempotent schema; a real service would test forward migrations against a copy of production data.                 |

## 7. Flaky-test policy

A flaky test is a bug, either in the test or in the product, and is treated as one.

1. **Detect.** CI retries E2E once and reports pass-on-retry as _flaky_. The nightly burn-in repeats integration (shuffled order) and E2E (no retries) five times.
2. **Contain.** If a flaky test blocks others, mark it `test.fixme` with a link to an issue. It must be fixed or deleted within one sprint.
3. **Fix the cause, not the symptom.** No sleeps, no longer timeouts without a reason. The usual causes in this codebase would be shared data (use a fresh database or unique ids), time (inject the clock), or ordering assumptions (assert on deltas).
4. **Learn.** Record the root cause in the issue so the pattern can be caught by a lint rule or a helper next time.

## 8. Metrics we watch

- Mutation score and coverage trend (job summary on every run).
- Flaky-test count from the burn-in (target: zero).
- Pipeline duration per stage (target: PR feedback in under 5 minutes).
- Escaped defects: every production bug gets a test at the lowest level that would have caught it.
