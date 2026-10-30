import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (
    sku          TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    price_cents  INTEGER NOT NULL CHECK (price_cents > 0),
    stock        INTEGER NOT NULL CHECK (stock >= 0)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id               TEXT PRIMARY KEY,
    customer_id      TEXT NOT NULL,
    status           TEXT NOT NULL,
    currency         TEXT NOT NULL,
    coupon_code      TEXT,
    subtotal_cents   INTEGER NOT NULL,
    discount_cents   INTEGER NOT NULL,
    shipping_cents   INTEGER NOT NULL,
    tax_cents        INTEGER NOT NULL,
    total_cents      INTEGER NOT NULL,
    payment_token    TEXT NOT NULL,
    payment_id       TEXT,
    idempotency_key  TEXT NOT NULL UNIQUE,
    request_hash     TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_lines (
    order_id          TEXT NOT NULL REFERENCES orders(id),
    sku               TEXT NOT NULL REFERENCES products(sku),
    name              TEXT NOT NULL,
    unit_price_cents  INTEGER NOT NULL,
    quantity          INTEGER NOT NULL,
    line_total_cents  INTEGER NOT NULL,
    PRIMARY KEY (order_id, sku)
  );
`;

export const DEMO_PRODUCTS = [
  { sku: 'KB-001', name: 'Mechanical keyboard', priceCents: 8_900, stock: 50 },
  { sku: 'MS-002', name: 'Wireless mouse', priceCents: 2_450, stock: 100 },
  { sku: 'CB-003', name: 'USB-C cable', priceCents: 999, stock: 500 },
  { sku: 'HD-004', name: 'Noise-cancelling headphones', priceCents: 19_900, stock: 3 },
] as const;

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(SCHEMA);
}

export async function seedProducts(
  pool: Pool,
  products: readonly {
    sku: string;
    name: string;
    priceCents: number;
    stock: number;
  }[] = DEMO_PRODUCTS,
): Promise<void> {
  for (const p of products) {
    await pool.query(
      `INSERT INTO products (sku, name, price_cents, stock) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku) DO UPDATE SET name = $2, price_cents = $3, stock = $4`,
      [p.sku, p.name, p.priceCents, p.stock],
    );
  }
}
