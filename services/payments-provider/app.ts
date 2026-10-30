/**
 * A stand-in for the payments team's service. In a real organisation this lives in
 * their repo; it is here so the provider side of the Pact contract can be verified
 * and the E2E stack has something real to call.
 *
 * Behaviour is driven by the payment token, like most payment sandboxes:
 *   tok_declined -> declined (insufficient_funds)
 *   any other tok_* -> approved
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';

const PaymentBody = z.object({
  orderId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  paymentToken: z.string().regex(/^tok_/),
});

interface Payment {
  id: string;
  status: 'approved' | 'declined';
  amountCents: number;
  currency: string;
  declineReason?: string;
}

export function buildPaymentsProvider() {
  const app = Fastify({ logger: false });
  const byIdempotencyKey = new Map<string, Payment>();

  app.post('/v1/payments', async (request, reply) => {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) {
      return reply.status(400).send({ error: 'missing_idempotency_key' });
    }
    const body = PaymentBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'invalid_request', message: body.error.message });
    }

    const existing = byIdempotencyKey.get(key);
    if (existing) return reply.status(201).send(existing);

    const declined = body.data.paymentToken === 'tok_declined';
    const payment: Payment = {
      id: `pay_${randomUUID()}`,
      status: declined ? 'declined' : 'approved',
      amountCents: body.data.amountCents,
      currency: body.data.currency,
      ...(declined ? { declineReason: 'insufficient_funds' } : {}),
    };
    byIdempotencyKey.set(key, payment);
    return reply.status(201).send(payment);
  });

  return {
    app,
    /** How many distinct charges were made. Lets tests prove "charged exactly once". */
    chargeCount: () => byIdempotencyKey.size,
    reset: () => byIdempotencyKey.clear(),
  };
}
