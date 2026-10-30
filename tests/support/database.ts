import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createPool, migrate, seedProducts, type Pool } from '../../src/db/database';

export interface TestDatabase {
  pool: Pool;
  /** Current stock of a product, read straight from the table. */
  stockOf(sku: string): Promise<number>;
  drop(): Promise<void>;
}

/**
 * Creates a fresh, migrated and seeded database inside the shared container.
 * Test files run in parallel without seeing each other's rows.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject('databaseUrl');
  const name = `test_${randomUUID().replaceAll('-', '')}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = createPool(url.toString());
  await migrate(pool);
  await seedProducts(pool);

  return {
    pool,
    async stockOf(sku) {
      const { rows } = await pool.query<{ stock: number }>(
        'SELECT stock FROM products WHERE sku = $1',
        [sku],
      );
      return rows[0]!.stock;
    },
    async drop() {
      await pool.end();
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.end();
    },
  };
}
