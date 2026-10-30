/**
 * Provider side: replays every interaction in the consumer's pact against the
 * running payments service and checks each real response matches.
 *
 * Locally (and in this repo's CI) the pact comes from the file the consumer test
 * just wrote. With a Pact Broker, set PACT_BROKER_BASE_URL (+ PACT_BROKER_TOKEN):
 * the verifier then fetches the pacts for deployed and main-branch consumers and
 * publishes the result, which is what `pact-broker can-i-deploy` reads.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Verifier, type VerifierOptions } from '@pact-foundation/pact';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPaymentsProvider } from '../../services/payments-provider/app';

const PACT_FILE = resolve('pacts/orders-service-payments-service.json');
const provider = buildPaymentsProvider();
let providerBaseUrl: string;

beforeAll(async () => {
  providerBaseUrl = await provider.app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await provider.app.close();
});

function pactSource(): Partial<VerifierOptions> {
  const brokerUrl = process.env.PACT_BROKER_BASE_URL;
  if (!brokerUrl) return { pactUrls: [PACT_FILE] };
  return {
    pactBrokerUrl: brokerUrl,
    pactBrokerToken: process.env.PACT_BROKER_TOKEN,
    consumerVersionSelectors: [{ mainBranch: true }, { deployedOrReleased: true }],
    publishVerificationResult: Boolean(process.env.CI),
    providerVersion: process.env.GITHUB_SHA ?? 'local',
    providerVersionBranch: process.env.GITHUB_REF_NAME ?? 'local',
  };
}

describe('payments-service honours its consumers', () => {
  it('satisfies every interaction orders-service relies on', async () => {
    if (!process.env.PACT_BROKER_BASE_URL) {
      expect(existsSync(PACT_FILE), 'Run `npm run test:contract:consumer` first').toBe(true);
    }

    // State handlers put the provider into the situation each interaction assumes.
    // The sandbox decides by token, so the only setup needed is a clean slate.
    const cleanSlate = () => {
      provider.reset();
      return Promise.resolve();
    };

    await new Verifier({
      provider: 'payments-service',
      providerBaseUrl,
      ...pactSource(),
      stateHandlers: {
        'card tok_visa is valid': cleanSlate,
        'card tok_declined has insufficient funds': cleanSlate,
      },
      logLevel: 'warn',
    }).verifyProvider();
  });
});
