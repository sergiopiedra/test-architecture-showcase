/**
 * Black-box API checks against the deployed stack: real HTTP, real Postgres, and the
 * real payments provider behind the real HTTP client. Integration tests already cover
 * the rules in depth with a fake gateway; these few prove the production wiring
 * (config, network calls, serialisation) works end to end.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';

const placeOrder = (request: APIRequestContext, data: object, key = randomUUID()) =>
  request.post('/orders', { data, headers: { 'idempotency-key': key } });

const cableOrder = (paymentToken = 'tok_visa') => ({
  customerId: 'cus_e2e',
  items: [{ sku: 'CB-003', quantity: 1 }],
  paymentToken,
});

test('an order is paid by the payments service and can be shipped @smoke', async ({ request }) => {
  const placed = await placeOrder(request, cableOrder());
  expect(placed.status()).toBe(201);
  const order = await placed.json();
  expect(order).toMatchObject({ status: 'PAID', totalCents: 1_578 });
  expect(order.paymentId).toMatch(/^pay_/);

  const shipped = await request.post(`/orders/${order.id}/ship`);
  expect(await shipped.json()).toMatchObject({ id: order.id, status: 'SHIPPED' });
});

test('a declined card comes back as 402 with the failed order', async ({ request }) => {
  const response = await placeOrder(request, cableOrder('tok_declined'));

  expect(response.status()).toBe(402);
  expect(await response.json()).toMatchObject({
    error: 'payment_declined',
    order: { status: 'PAYMENT_FAILED', paymentId: expect.stringMatching(/^pay_/) },
  });
});

test('retrying with the same Idempotency-Key returns the same order', async ({ request }) => {
  const key = randomUUID();

  const first = await placeOrder(request, cableOrder(), key);
  const retry = await placeOrder(request, cableOrder(), key);

  expect(first.status()).toBe(201);
  expect(retry.status()).toBe(200);
  expect(retry.headers()['idempotent-replayed']).toBe('true');
  expect((await retry.json()).id).toBe((await first.json()).id);
});
