# ADR 0002: Real Postgres via Testcontainers for integration tests

**Status:** accepted

## Context

The two highest-impact risks after pricing are overselling under concurrency (R2) and double charging on retry (R3). Both are protected by database behaviour: row locks, a conditional `UPDATE`, a unique index on the idempotency key and transaction rollback. An in-memory fake or SQLite would not reproduce Postgres' locking and isolation semantics, so a green test there would prove nothing about production.

## Decision

Integration tests run against **Postgres 17 in a container**, started by Testcontainers in Vitest's `globalSetup`:

- one container per test run (a container per file would add seconds each);
- one freshly migrated and seeded **database per test file**, so files run in parallel with full isolation;
- tests assert on deltas, never on absolute values.

## Consequences

- Concurrency tests (`concurrency.test.ts`) exercise real lock contention. Removing the `stock >= qty` guard makes the oversell test fail: the `CHECK (stock >= 0)` constraint still stops the oversell, but 7 customers get a `500` instead of a clean `409 out_of_stock`. Defence in depth, and the test tells the two layers apart.
- Developers need Docker (or Colima) locally; GitHub's Ubuntu runners have it already.
- The first run pulls the image (about 100 MB); later runs start the container in about 2 s.
