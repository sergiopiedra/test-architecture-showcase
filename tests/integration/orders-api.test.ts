/**
 * The HTTP API wired to a real Postgres (Testcontainers) and a fake payments gateway.
 * Requests go through Fastify's `inject`, so there is no network or port to manage,
 * but routing, validation, SQL, transactions and error mapping are all real.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { PaymentsError } from '../../src/payments/payments-client';
import { anIdempotencyKey, anOrderRequest, type OrderRequestBody } from '../support/builders';
import { createTestDatabase, type TestDatabase } from '../support/database';
import { FakePayments } from '../support/fake-payments';

const NOW = new Date('2026-01-15T10:00:00.000Z');
let sequence = 0;

let db: TestDatabase;
let payments: FakePayments;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.drop();
});

beforeEach(() => {
  payments = new FakePayments();
  app = buildApp({
    pool: db.pool,
    payments,
    clock: () => NOW,
    newId: () => `ord_test_${++sequence}`,
  });
});

const placeOrder = (body: OrderRequestBody | object, key: string | null = anIdempotencyKey()) =>
  app.inject({
    method: 'POST',
    url: '/orders',
    headers: key ? { 'idempotency-key': key } : {},
    payload: body,
  });

describe('POST /orders', () => {
  it('creates a paid order and charges the exact total once', async () => {
    const stockBefore = await db.stockOf('KB-001');

    const response = await placeOrder(
      anOrderRequest().withItem('KB-001').withCoupon('save10').build(),
    );

    expect(response.statusCode).toBe(201);
    const order = response.json();
    expect(order).toMatchObject({
      status: 'PAID',
      couponCode: 'SAVE10',
      subtotalCents: 8_900,
      discountCents: 890,
      shippingCents: 0,
      taxCents: 641,
      totalCents: 8_651,
      paymentId: 'pay_1',
      createdAt: NOW.toISOString(),
    });
    expect(payments.calls).toEqual([
      {
        orderId: order.id,
        amountCents: 8_651,
        currency: 'EUR',
        paymentToken: 'tok_visa',
        idempotencyKey: order.id,
      },
    ]);
    expect(await db.stockOf('KB-001')).toBe(stockBefore - 1);

    const fetched = await app.inject({ method: 'GET', url: `/orders/${order.id}` });
    expect(fetched.json()).toEqual(order);
  });

  it('returns 402 and gives the stock back when the card is declined', async () => {
    const stockBefore = await db.stockOf('MS-002');

    const response = await placeOrder(
      anOrderRequest().withItem('MS-002', 2).payingWith('tok_declined').build(),
    );

    expect(response.statusCode).toBe(402);
    expect(response.json()).toMatchObject({
      error: 'payment_declined',
      order: { status: 'PAYMENT_FAILED' },
    });
    expect(await db.stockOf('MS-002')).toBe(stockBefore);
  });

  it('requires an Idempotency-Key header', async () => {
    const response = await placeOrder(anOrderRequest().build(), null);

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('missing_idempotency_key');
  });

  it('explains every invalid field', async () => {
    const response = await placeOrder({ customerId: '', items: 'nope' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_error' });
    expect(response.json().issues.map((issue: { path: string }) => issue.path)).toEqual([
      'customerId',
      'items',
      'paymentToken',
    ]);
  });

  it('rejects malformed JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      headers: { 'idempotency-key': anIdempotencyKey(), 'content-type': 'application/json' },
      payload: '{"customerId":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it.each([
    {
      name: 'unknown SKU',
      body: anOrderRequest().withItem('NOPE-1').build(),
      code: 'unknown_sku',
      status: 422,
    },
    {
      name: 'quantity over the limit',
      body: anOrderRequest().withItem('CB-003', 11).build(),
      code: 'invalid_quantity',
      status: 422,
    },
    {
      name: 'unknown coupon',
      body: anOrderRequest().withCoupon('BOGUS').build(),
      code: 'invalid_coupon',
      status: 422,
    },
    {
      name: 'more than in stock',
      body: anOrderRequest().withItem('HD-004', 4).build(),
      code: 'out_of_stock',
      status: 409,
    },
  ])('rejects $name with $status $code and reserves nothing', async ({ body, code, status }) => {
    const stockBefore = await db.stockOf('HD-004');

    const response = await placeOrder(body);

    expect(response.statusCode).toBe(status);
    expect(response.json().error).toBe(code);
    expect(payments.calls).toHaveLength(0);
    expect(await db.stockOf('HD-004')).toBe(stockBefore);
  });

  it('maps an unexpected failure to a generic 500 without leaking details', async () => {
    payments.charge = () => Promise.reject(new Error('socket hang up: secret-host:5432'));

    const response = await placeOrder(anOrderRequest().build());

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error', message: 'Something went wrong' });
  });
});

describe('idempotency', () => {
  it('replays the original order instead of creating or charging a second one', async () => {
    const key = anIdempotencyKey();
    const body = anOrderRequest().withItem('CB-003', 2).build();
    const stockBefore = await db.stockOf('CB-003');

    const first = await placeOrder(body, key);
    const second = await placeOrder(body, key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(payments.calls).toHaveLength(1);
    expect(await db.stockOf('CB-003')).toBe(stockBefore - 2);
  });

  it('refuses a reused key with a different body', async () => {
    const key = anIdempotencyKey();
    await placeOrder(anOrderRequest().withItem('CB-003', 1).build(), key);

    const response = await placeOrder(anOrderRequest().withItem('CB-003', 2).build(), key);

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('idempotency_key_reused');
  });

  it('survives a payments outage: 503 now, paid on retry, charged exactly once', async () => {
    const key = anIdempotencyKey();
    const body = anOrderRequest().withItem('CB-003').build();
    payments.willBeUnavailable(1);

    const first = await placeOrder(body, key);
    expect(first.statusCode).toBe(503);
    const { orderId } = first.json();
    expect(first.json().error).toBe('payment_pending');

    const pending = await app.inject({ method: 'GET', url: `/orders/${orderId}` });
    expect(pending.json().status).toBe('PENDING_PAYMENT');

    const retry = await placeOrder(body, key);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ id: orderId, status: 'PAID' });
    expect(payments.calls).toHaveLength(2);
    expect(payments.distinctCharges).toBe(1);
  });

  it('reports a non-retryable payments failure as 502', async () => {
    payments.willRespond(new PaymentsError('Payments rejected the request with 400', false));

    const response = await placeOrder(anOrderRequest().build());

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toBe('payments_error');
  });
});

describe('order lifecycle', () => {
  async function aPaidOrder(sku = 'CB-003', quantity = 1): Promise<string> {
    const response = await placeOrder(anOrderRequest().withItem(sku, quantity).build());
    expect(response.statusCode).toBe(201);
    return response.json().id;
  }

  const post = (url: string) => app.inject({ method: 'POST', url });

  it('ships a paid order, and a shipped order can no longer be cancelled', async () => {
    const id = await aPaidOrder();

    const shipped = await post(`/orders/${id}/ship`);
    expect(shipped.statusCode).toBe(200);
    expect(shipped.json().status).toBe('SHIPPED');

    const cancel = await post(`/orders/${id}/cancel`);
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().error).toBe('invalid_transition');
  });

  it('puts the stock back when a paid order is cancelled', async () => {
    const stockBefore = await db.stockOf('MS-002');
    const id = await aPaidOrder('MS-002', 3);
    expect(await db.stockOf('MS-002')).toBe(stockBefore - 3);

    const cancelled = await post(`/orders/${id}/cancel`);

    expect(cancelled.json().status).toBe('CANCELLED');
    expect(await db.stockOf('MS-002')).toBe(stockBefore);
  });

  it('does not release stock twice when a declined order is cancelled', async () => {
    const stockBefore = await db.stockOf('MS-002');
    const declined = await placeOrder(
      anOrderRequest().withItem('MS-002', 2).payingWith('tok_declined').build(),
    );
    const { id } = declined.json().order;

    await post(`/orders/${id}/cancel`);

    expect(await db.stockOf('MS-002')).toBe(stockBefore);
  });

  it('returns 404 for an order that does not exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/orders/ord_missing' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('order_not_found');
  });
});

describe('catalogue and health', () => {
  it('lists the products with price and stock', async () => {
    const response = await app.inject({ method: 'GET', url: '/products' });

    expect(response.statusCode).toBe(200);
    expect(response.json().products).toContainEqual(
      expect.objectContaining({ sku: 'KB-001', name: 'Mechanical keyboard', priceCents: 8_900 }),
    );
  });

  it('reports healthy when the database answers', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('serves the storefront page', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<h1>Demo Store</h1>');
  });
});
