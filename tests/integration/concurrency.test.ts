/**
 * Race conditions only show up against a real database with real connections,
 * which is the main reason this suite uses Postgres instead of an in-memory fake.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { anIdempotencyKey, anOrderRequest, type OrderRequestBody } from '../support/builders';
import { createTestDatabase, type TestDatabase } from '../support/database';
import { FakePayments } from '../support/fake-payments';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.drop();
});

function anApp(payments = new FakePayments()): FastifyInstance {
  return buildApp({ pool: db.pool, payments });
}

const placeOrder = (app: FastifyInstance, body: OrderRequestBody, key = anIdempotencyKey()) =>
  app.inject({
    method: 'POST',
    url: '/orders',
    headers: { 'idempotency-key': key },
    payload: body,
  });

describe('under concurrent load', () => {
  it('never oversells: 10 simultaneous buyers, 3 units in stock', async () => {
    const app = anApp();
    expect(await db.stockOf('HD-004')).toBe(3);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        placeOrder(app, anOrderRequest().forCustomer(`cus_${i}`).withItem('HD-004').build()),
      ),
    );

    const statuses = responses.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([201, 201, 201, 409, 409, 409, 409, 409, 409, 409]);
    expect(
      responses.filter((r) => r.statusCode === 409).every((r) => r.json().error === 'out_of_stock'),
    ).toBe(true);
    expect(await db.stockOf('HD-004')).toBe(0);
  });

  it('turns 5 simultaneous retries of one request into one order and one charge', async () => {
    const payments = new FakePayments();
    const app = anApp(payments);
    const key = anIdempotencyKey();
    const body = anOrderRequest().withItem('KB-001').build();
    const stockBefore = await db.stockOf('KB-001');

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => placeOrder(app, body, key)),
    );

    const ids = new Set(responses.map((r) => r.json().id));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(responses.every((r) => r.json().status === 'PAID')).toBe(true);
    expect(payments.distinctCharges).toBe(1);
    expect(await db.stockOf('KB-001')).toBe(stockBefore - 1);
  });

  it('lets exactly one of a simultaneous ship and cancel win', async () => {
    const app = anApp();
    const placed = await placeOrder(app, anOrderRequest().withItem('MS-002', 2).build());
    const id: string = placed.json().id;
    const stockAfterOrder = await db.stockOf('MS-002');

    const [ship, cancel] = await Promise.all([
      app.inject({ method: 'POST', url: `/orders/${id}/ship` }),
      app.inject({ method: 'POST', url: `/orders/${id}/cancel` }),
    ]);

    expect([ship.statusCode, cancel.statusCode].sort()).toEqual([200, 409]);
    const final = (await app.inject({ method: 'GET', url: `/orders/${id}` })).json();
    const cancelWon = cancel.statusCode === 200;
    expect(final.status).toBe(cancelWon ? 'CANCELLED' : 'SHIPPED');
    expect(await db.stockOf('MS-002')).toBe(cancelWon ? stockAfterOrder + 2 : stockAfterOrder);
  });
});
