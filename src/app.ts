import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from './db/database';
import { OrderRepository } from './db/order-repository';
import { ProductRepository } from './db/product-repository';
import { DomainError } from './domain/errors';
import { OrderService } from './order-service';
import type { PaymentsGateway } from './payments/payments-client';

export interface AppDeps {
  pool: Pool;
  payments: PaymentsGateway;
  clock?: () => Date;
  newId?: () => string;
  logger?: boolean;
}

const CreateOrderBody = z.object({
  customerId: z.string().trim().min(1).max(64),
  items: z.array(z.object({ sku: z.string().trim().min(1), quantity: z.number().int() })).min(1),
  couponCode: z.string().trim().max(32).optional(),
  paymentToken: z.string().trim().min(1),
});

const IdempotencyKey = z.string().trim().min(8).max(100);
const OrderParams = z.object({ id: z.string().min(1) });

const storefront = readFileSync(join(import.meta.dirname, 'public', 'index.html'), 'utf8');

/** Builds the HTTP app from its dependencies. Nothing here reads env vars or opens sockets. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  const products = new ProductRepository(deps.pool);
  const service = new OrderService({
    orders: new OrderRepository(deps.pool),
    products,
    payments: deps.payments,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.newId ? { newId: deps.newId } : {}),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message, ...error.details });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'The request is invalid',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: 'bad_request', message: (error as Error).message });
    }
    request.log.error(error);
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  app.get('/', (_request, reply) => reply.type('text/html').send(storefront));

  app.get('/health', async () => {
    await deps.pool.query('SELECT 1');
    return { status: 'ok' };
  });

  app.get('/products', async () => ({ products: await products.list() }));

  app.post('/orders', async (request, reply) => {
    const key = IdempotencyKey.safeParse(request.headers['idempotency-key']);
    if (!key.success) {
      throw new DomainError(
        'missing_idempotency_key',
        'Send an Idempotency-Key header (8-100 characters) so retries are safe',
        400,
      );
    }
    const body = CreateOrderBody.parse(request.body);
    const result = await service.placeOrder({ ...body, idempotencyKey: key.data });

    if (result.replayed) reply.header('idempotent-replayed', 'true');
    if (result.order.status === 'PAYMENT_FAILED') {
      return reply.status(402).send({
        error: 'payment_declined',
        message: 'The payment was declined',
        order: result.order,
      });
    }
    return reply.status(result.replayed ? 200 : 201).send(result.order);
  });

  app.get('/orders/:id', async (request) => service.getOrder(OrderParams.parse(request.params).id));

  app.post('/orders/:id/ship', async (request) =>
    service.ship(OrderParams.parse(request.params).id),
  );

  app.post('/orders/:id/cancel', async (request) =>
    service.cancel(OrderParams.parse(request.params).id),
  );

  return app;
}
