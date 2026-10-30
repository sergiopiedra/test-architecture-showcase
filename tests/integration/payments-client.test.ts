/**
 * Fault injection for the payments HTTP adapter. MSW intercepts `fetch` at the
 * network layer, so the real client code (headers, timeouts, retries, parsing)
 * runs against outages we could never trigger reliably on a real provider.
 */
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  HttpPaymentsClient,
  PaymentsError,
  type ChargeRequest,
} from '../../src/payments/payments-client';

const BASE_URL = 'http://payments.test';
const ENDPOINT = `${BASE_URL}/v1/payments`;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const request: ChargeRequest = {
  orderId: 'ord_1',
  amountCents: 1_578,
  currency: 'EUR',
  paymentToken: 'tok_visa',
  idempotencyKey: 'ord_1',
};

const approved = { id: 'pay_1', status: 'approved', amountCents: 1_578, currency: 'EUR' };

const client = (options: { timeoutMs?: number; backoffMs?: number } = {}) =>
  new HttpPaymentsClient({ baseUrl: BASE_URL, timeoutMs: 200, backoffMs: 1, ...options });

/** Responds with each response in turn and records every request it saw. */
function respondInSequence(...responses: (() => Response | Promise<Response>)[]) {
  const seen: { at: number; idempotencyKey: string | null }[] = [];
  server.use(
    http.post(ENDPOINT, ({ request: req }) => {
      seen.push({ at: performance.now(), idempotencyKey: req.headers.get('idempotency-key') });
      const next = responses[Math.min(seen.length - 1, responses.length - 1)]!;
      return next();
    }),
  );
  return seen;
}

async function captureError(promise: Promise<unknown>): Promise<PaymentsError> {
  const error = await promise.then(
    () => expect.fail('expected the charge to fail'),
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PaymentsError);
  return error as PaymentsError;
}

describe('HttpPaymentsClient', () => {
  it('sends the agreed request and maps an approval', async () => {
    let sent: Request | undefined;
    server.use(
      http.post(ENDPOINT, ({ request: req }) => {
        sent = req.clone();
        return HttpResponse.json(approved, { status: 201 });
      }),
    );

    const result = await client().charge(request);

    expect(result).toEqual({ paymentId: 'pay_1', status: 'approved', declineReason: null });
    expect(sent!.headers.get('idempotency-key')).toBe('ord_1');
    expect(sent!.headers.get('content-type')).toBe('application/json');
    expect(await sent!.json()).toEqual({
      orderId: 'ord_1',
      amountCents: 1_578,
      currency: 'EUR',
      paymentToken: 'tok_visa',
    });
  });

  it('maps a decline with its reason', async () => {
    respondInSequence(() =>
      HttpResponse.json(
        { ...approved, status: 'declined', declineReason: 'insufficient_funds' },
        { status: 201 },
      ),
    );

    expect(await client().charge(request)).toEqual({
      paymentId: 'pay_1',
      status: 'declined',
      declineReason: 'insufficient_funds',
    });
  });

  it.each([500, 502, 503, 429])('retries a %s and reuses the idempotency key', async (status) => {
    const seen = respondInSequence(
      () => new HttpResponse(null, { status }),
      () => HttpResponse.json(approved, { status: 201 }),
    );

    await expect(client().charge(request)).resolves.toMatchObject({ status: 'approved' });
    expect(seen.map((s) => s.idempotencyKey)).toEqual(['ord_1', 'ord_1']);
  });

  it('backs off exponentially between attempts', async () => {
    const seen = respondInSequence(() => new HttpResponse(null, { status: 503 }));

    await captureError(client({ backoffMs: 30 }).charge(request));

    expect(seen).toHaveLength(3);
    // Lower bounds only: a slow machine may wait longer, never shorter.
    expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(29);
    expect(seen[2]!.at - seen[1]!.at).toBeGreaterThanOrEqual(59);
  });

  it('gives up after 3 attempts with a retryable error', async () => {
    const seen = respondInSequence(() => new HttpResponse(null, { status: 503 }));

    const error = await captureError(client().charge(request));

    expect(seen).toHaveLength(3);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe('Payments unavailable after 3 attempts: Payments responded 503');
  });

  it('times out a provider that hangs, and retries', async () => {
    const seen = respondInSequence(async () => {
      await delay('infinite');
      return HttpResponse.json(approved, { status: 201 });
    });

    const error = await captureError(client({ timeoutMs: 50 }).charge(request));

    expect(seen).toHaveLength(3);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('Payments request timed out');
  });

  it('treats a dropped connection as retryable', async () => {
    respondInSequence(
      () => HttpResponse.error(),
      () => HttpResponse.json(approved, { status: 201 }),
    );

    await expect(client().charge(request)).resolves.toMatchObject({ status: 'approved' });
  });

  it('does not retry a 4xx: the request itself is wrong', async () => {
    const seen = respondInSequence(() =>
      HttpResponse.json({ error: 'invalid_request' }, { status: 400 }),
    );

    const error = await captureError(client().charge(request));

    expect(seen).toHaveLength(1);
    expect(error.retryable).toBe(false);
  });

  it.each([
    ['an unknown status', { ...approved, status: 'pending' }],
    ['a missing id', { status: 'approved', amountCents: 1, currency: 'EUR' }],
    ['a body that is not JSON', 'not json'],
  ])('fails loudly on %s instead of guessing', async (_case, body) => {
    respondInSequence(() =>
      typeof body === 'string'
        ? new HttpResponse(body, { status: 201 })
        : HttpResponse.json(body, { status: 201 }),
    );

    const error = await captureError(client().charge(request));

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('Unexpected payments response');
  });
});
