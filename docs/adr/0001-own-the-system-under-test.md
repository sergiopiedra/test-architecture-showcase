# ADR 0001: Own the system under test

**Status:** accepted

## Context

Public practice sites (Sauce Demo, restful-booker, reqres) are convenient targets, but they are shared, rate limited, reset at random and outside our control. You cannot add a race condition, a database or a flaky dependency to them, so you cannot show how a test strategy handles one.

## Decision

The repo contains its own system under test: a small order service with a Postgres database, a payments dependency and a UI. The service is intentionally small (about 1,000 lines of TypeScript, comments included) but includes the things that make real systems hard to test: money, concurrency, idempotency, an unreliable third party, and a lifecycle.

## Consequences

- Every test is deterministic and runs offline, except for pulling the Postgres image once.
- The tests can reach inside: inject a clock, script a payments outage, read stock straight from the database.
- The code can be shaped for testability, and that design is part of what the repo demonstrates.
- Cost: the product code must be maintained as well. It is kept minimal on purpose.
