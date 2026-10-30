/**
 * Starts everything the E2E suite needs, in one process:
 *   1. Postgres in a throwaway container (skipped if DATABASE_URL is set)
 *   2. the payments provider on PAYMENTS_PORT (default 4010)
 *   3. the order service on PORT (default 3000)
 *
 * Playwright runs this as its webServer; `npm start` runs it for manual exploration.
 */
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { buildPaymentsProvider } from '../services/payments-provider/app';
import { startOrdersServer } from '../src/server';

const port = Number(process.env.PORT ?? 3000);
const paymentsPort = Number(process.env.PAYMENTS_PORT ?? 4010);

let databaseUrl = process.env.DATABASE_URL;
const container = databaseUrl
  ? undefined
  : await new PostgreSqlContainer('postgres:17-alpine').start();
databaseUrl ??= container!.getConnectionUri();

const payments = buildPaymentsProvider();
await payments.app.listen({ port: paymentsPort, host: '127.0.0.1' });

const orders = await startOrdersServer({
  port,
  databaseUrl,
  paymentsUrl: `http://127.0.0.1:${paymentsPort}`,
  logger: process.env.LOG_REQUESTS === 'true',
});

console.log(`Storefront ready on http://127.0.0.1:${port}`);

async function shutdown() {
  await orders.close();
  await payments.app.close();
  await container?.stop();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
