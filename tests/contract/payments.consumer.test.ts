/**
 * Consumer side of the orders-service -> payments-service contract.
 *
 * Each interaction runs our real HTTP client against a Pact mock server. Pact checks
 * that the client sends exactly what the interaction describes, and writes the
 * interactions to pacts/orders-service-payments-service.json. The provider then
 * verifies that file (payments.provider.test.ts), so neither side can change the
 * API without the other side's build noticing.
 *
 * Matchers (`like`, `integer`) say "any value of this type": the contract pins the
 * shape the consumer depends on, not the example values.
 */
import { resolve } from 'node:path';
import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { HttpPaymentsClient, PaymentsError } from '../../src/payments/payments-client';

const { like, integer } = MatchersV3;

const pact = new PactV4({
  consumer: 'orders-service',
  provider: 'payments-service',
  dir: resolve('pacts'),
  logLevel: 'warn',
});

const chargeRequest = (paymentToken: string) => ({
  orderId: like('ord_7f3a'),
  amountCents: integer(1_578),
  currency: 'EUR',
  paymentToken,
});

const clientFor = (url: string) => new HttpPaymentsClient({ baseUrl: url, maxAttempts: 1 });

const charge = (paymentToken: string) => ({
  orderId: 'ord_7f3a',
  amountCents: 1_578,
  currency: 'EUR',
  paymentToken,
  idempotencyKey: 'ord_7f3a',
});

describe('orders-service -> payments-service', () => {
  it('charges a valid card', async () => {
    await pact
      .addInteraction()
      .given('card tok_visa is valid')
      .uponReceiving('a charge for a valid card')
      .withRequest('POST', '/v1/payments', (request) =>
        request
          .headers({ 'content-type': 'application/json', 'idempotency-key': like('ord_7f3a') })
          .jsonBody(chargeRequest('tok_visa')),
      )
      .willRespondWith(201, (response) =>
        response.jsonBody({
          id: like('pay_91c2'),
          status: 'approved',
          amountCents: integer(1_578),
          currency: 'EUR',
        }),
      )
      .executeTest(async (mockServer) => {
        const result = await clientFor(mockServer.url).charge(charge('tok_visa'));

        expect(result).toEqual({ paymentId: 'pay_91c2', status: 'approved', declineReason: null });
      });
  });

  it('is told why a card was declined', async () => {
    await pact
      .addInteraction()
      .given('card tok_declined has insufficient funds')
      .uponReceiving('a charge for a card that will be declined')
      .withRequest('POST', '/v1/payments', (request) =>
        request
          .headers({ 'content-type': 'application/json', 'idempotency-key': like('ord_7f3a') })
          .jsonBody(chargeRequest('tok_declined')),
      )
      .willRespondWith(201, (response) =>
        response.jsonBody({
          id: like('pay_91c3'),
          status: 'declined',
          amountCents: integer(1_578),
          currency: 'EUR',
          declineReason: like('insufficient_funds'),
        }),
      )
      .executeTest(async (mockServer) => {
        const result = await clientFor(mockServer.url).charge(charge('tok_declined'));

        expect(result).toEqual({
          paymentId: 'pay_91c3',
          status: 'declined',
          declineReason: 'insufficient_funds',
        });
      });
  });

  it('gets a 400 for a malformed payment token and does not retry it', async () => {
    await pact
      .addInteraction()
      .uponReceiving('a charge with a malformed payment token')
      .withRequest('POST', '/v1/payments', (request) =>
        request
          .headers({ 'content-type': 'application/json', 'idempotency-key': like('ord_7f3a') })
          .jsonBody(chargeRequest('not-a-token')),
      )
      .willRespondWith(400, (response) => response.jsonBody({ error: like('invalid_request') }))
      .executeTest(async (mockServer) => {
        const failure = clientFor(mockServer.url).charge(charge('not-a-token'));

        await expect(failure).rejects.toBeInstanceOf(PaymentsError);
        await expect(failure).rejects.toMatchObject({ retryable: false });
      });
  });
});
