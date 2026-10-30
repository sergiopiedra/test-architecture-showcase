# ADR 0003: Consumer-driven contracts with Pact for the payments API

**Status:** accepted

## Context

orders-service depends on payments-service, which another team owns and deploys on its own schedule. The options were:

| Option                                 | Problem                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| E2E tests against a shared environment | Slow, flaky, and they find the break _after_ both sides deployed         |
| Mocks in our integration tests only    | They encode our _assumptions_; nothing checks them against the provider  |
| OpenAPI schema validation              | Proves the provider matches its spec, not that it supports what _we_ use |

## Decision

Use **Pact**. Our consumer tests run the real `HttpPaymentsClient` against a Pact mock server and record the interactions we depend on (approve, decline, 400 on bad input). The provider replays that pact against its running service.

Matchers (`like`, `integer`) pin the _shape_ we rely on, not example values, so the provider can change ids or amounts freely but cannot rename `status` or drop `declineReason`.

In this repo the provider stand-in lives in `services/payments-provider` and verification reads the local pact file. With a Pact Broker (set `PACT_BROKER_BASE_URL`), the verifier fetches pacts for main-branch and deployed consumers and publishes results, and both pipelines gate deploys with `pact-broker can-i-deploy`.

## Consequences

- A breaking change fails in the provider's own build, before deploy. This was checked by renaming `status` to `state` in the provider: verification fails with "Actual map is missing the following keys: status".
- Contract tests do not replace the client's fault-injection tests: Pact checks shape, MSW checks behaviour under failure.
- The client also validates responses at runtime (zod), so drift that slips past contracts fails loudly instead of corrupting an order.
