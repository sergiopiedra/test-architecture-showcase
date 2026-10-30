# ADR 0005: A deliberately thin E2E layer

**Status:** accepted

## Context

E2E tests are the most realistic and the most expensive: they are slow, need the whole stack, and fail for reasons unrelated to the change under review. Every rule they check is also cheaper to check lower down.

## Decision

E2E tests exist only to prove that **the deployed pieces work together**, plus the single most important user journey. There are 7:

- **UI (4):** buy with a coupon (smoke), a declined card, an invalid coupon, an empty cart. The UI is read for what the shopper sees, then the order is confirmed through the API rather than by scraping more of the page.
- **API (3):** pay and ship through the real payments service (smoke), a decline as `402`, an idempotent replay over real HTTP.

New E2E tests need a reason that no lower level can satisfy (see "Where does a new test go?" in the test strategy).

## Consequences

- The E2E stage takes seconds, so it runs on every PR rather than nightly.
- `scripts/start-stack.ts` gives each run its own Postgres container, so E2E tests never share data with a previous run.
- Tests choose products with plenty of stock and assert on their own orders, so they can run in parallel and under `--repeat-each` in the burn-in.
