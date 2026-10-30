import type { Pool } from './database';

export interface Product {
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
}

interface ProductRow {
  sku: string;
  name: string;
  price_cents: number;
  stock: number;
}

const toProduct = (row: ProductRow): Product => ({
  sku: row.sku,
  name: row.name,
  priceCents: row.price_cents,
  stock: row.stock,
});

export class ProductRepository {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Product[]> {
    const { rows } = await this.pool.query<ProductRow>('SELECT * FROM products ORDER BY sku');
    return rows.map(toProduct);
  }

  async findBySkus(skus: readonly string[]): Promise<Map<string, Product>> {
    const { rows } = await this.pool.query<ProductRow>(
      'SELECT * FROM products WHERE sku = ANY($1)',
      [skus],
    );
    return new Map(rows.map((row) => [row.sku, toProduct(row)]));
  }
}
