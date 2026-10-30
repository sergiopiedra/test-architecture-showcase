# ADR 0004: Mutation testing, scoped to the domain

**Status:** accepted

## Context

Line coverage says a line ran, not that a test would notice if it were wrong. Pricing (R1) is the top risk and is full of boundaries (`>=` at the free-shipping threshold, quantity 1–10, half-up rounding) where a weak assertion lets an off-by-one through.

## Decision

Run **Stryker** on `src/domain/**` with the unit tests, and fail the build below a **90 % mutation score**.

Scope is limited to the domain because:

- those are the rules where a silent mistake costs money;
- unit tests are fast, so each of the ~150 mutants runs in milliseconds and the job takes under a minute;
- mutating repositories or HTTP code would need the slow suites and mostly produce noise.

## Consequences

- The first run found a real gap: a rate of exactly 0 bp was never tested, so `rate < 0` could become `rate <= 0` unnoticed. A test was added.
- The remaining survivors change only human-readable error messages. We assert on stable error _codes_, not prose, so these are accepted and reviewed rather than chased.
- The HTML report (`reports/mutation/index.html`, also a CI artifact) shows every surviving mutant in context.
