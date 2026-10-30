import { buildApp } from './app';
import { createPool, migrate, seedProducts } from './db/database';
import { HttpPaymentsClient } from './payments/payments-client';

export interface OrdersServerOptions {
  port: number;
  databaseUrl: string;
  paymentsUrl: string;
  logger?: boolean;
}

/** Starts the order service for real: migrates and seeds the database, then listens. */
export async function startOrdersServer(options: OrdersServerOptions) {
  const pool = createPool(options.databaseUrl);
  await migrate(pool);
  await seedProducts(pool);

  const app = buildApp({
    pool,
    payments: new HttpPaymentsClient({ baseUrl: options.paymentsUrl }),
    logger: options.logger ?? true,
  });
  app.addHook('onClose', () => pool.end());
  await app.listen({ port: options.port, host: '127.0.0.1' });
  return app;
}
