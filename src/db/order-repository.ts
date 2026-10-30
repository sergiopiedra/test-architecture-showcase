import type { PoolClient } from 'pg';
import { DomainError } from '../domain/errors';
import type { Order } from '../domain/order';
import type { OrderStatus } from '../domain/order-status';
import type { Pool } from './database';

export interface NewOrder {
  order: Order;
  paymentToken: string;
  idempotencyKey: string;
  requestHash: string;
}

export interface StoredRequest {
  order: Order;
  paymentToken: string;
  requestHash: string;
}

interface OrderRow {
  id: string;
  customer_id: string;
  status: OrderStatus;
  currency: string;
  coupon_code: string | null;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  payment_token: string;
  payment_id: string | null;
  request_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface LineRow {
  sku: string;
  name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

const UNIQUE_VIOLATION = '23505';

/** Thrown inside the transaction so it rolls back the stock reservation too. */
class DuplicateIdempotencyKey extends Error {}

export class OrderRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Inserts the order and decrements stock in one transaction.
   * Returns `false` (and changes nothing) if another request already used the idempotency key.
   */
  async insertReservingStock(input: NewOrder): Promise<boolean> {
    const { order } = input;
    return this.inTransaction(async (tx) => {
      // Lock rows in a fixed order so two concurrent orders can never deadlock.
      const bySku = [...order.lines].sort((a, b) => a.sku.localeCompare(b.sku));
      for (const line of bySku) {
        // The WHERE clause is the oversell guard: concurrent updaters queue on the row lock
        // and re-check `stock >= quantity` once the previous transaction commits.
        const { rowCount } = await tx.query(
          'UPDATE products SET stock = stock - $2 WHERE sku = $1 AND stock >= $2',
          [line.sku, line.quantity],
        );
        if (rowCount === 0) {
          throw new DomainError('out_of_stock', `Not enough stock for ${line.sku}`, 409);
        }
      }

      try {
        await tx.query(
          `INSERT INTO orders (id, customer_id, status, currency, coupon_code, subtotal_cents,
             discount_cents, shipping_cents, tax_cents, total_cents, payment_token, payment_id,
             idempotency_key, request_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
          [
            order.id,
            order.customerId,
            order.status,
            order.currency,
            order.couponCode,
            order.subtotalCents,
            order.discountCents,
            order.shippingCents,
            order.taxCents,
            order.totalCents,
            input.paymentToken,
            order.paymentId,
            input.idempotencyKey,
            input.requestHash,
            order.createdAt,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
          throw new DuplicateIdempotencyKey(input.idempotencyKey);
        }
        throw error;
      }

      for (const line of order.lines) {
        await tx.query(
          `INSERT INTO order_lines (order_id, sku, name, unit_price_cents, quantity, line_total_cents)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [order.id, line.sku, line.name, line.unitPriceCents, line.quantity, line.lineTotalCents],
        );
      }
      return true;
    }).catch((error: unknown) => {
      if (error instanceof DuplicateIdempotencyKey) return false;
      throw error;
    });
  }

  async findById(id: string): Promise<Order | null> {
    const { rows } = await this.pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async findByIdempotencyKey(key: string): Promise<StoredRequest | null> {
    const { rows } = await this.pool.query<OrderRow>(
      'SELECT * FROM orders WHERE idempotency_key = $1',
      [key],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      order: await this.hydrate(row),
      paymentToken: row.payment_token,
      requestHash: row.request_hash,
    };
  }

  /**
   * Compare-and-set on the status column: the update only applies if the order is still
   * in `from`. Returns null when a concurrent request changed it first.
   */
  async transition(
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    options: { now: string; paymentId?: string; releaseStock?: boolean },
  ): Promise<Order | null> {
    const updated = await this.inTransaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE orders SET status = $3, updated_at = $4, payment_id = COALESCE($5, payment_id)
         WHERE id = $1 AND status = $2`,
        [id, from, to, options.now, options.paymentId ?? null],
      );
      if (rowCount === 0) return false;
      if (options.releaseStock) {
        await tx.query(
          `UPDATE products p SET stock = p.stock + l.quantity
           FROM order_lines l WHERE l.order_id = $1 AND l.sku = p.sku`,
          [id],
        );
      }
      return true;
    });
    return updated ? this.findById(id) : null;
  }

  private async hydrate(row: OrderRow): Promise<Order> {
    const { rows } = await this.pool.query<LineRow>(
      'SELECT * FROM order_lines WHERE order_id = $1 ORDER BY sku',
      [row.id],
    );
    return {
      id: row.id,
      customerId: row.customer_id,
      status: row.status,
      currency: row.currency,
      couponCode: row.coupon_code,
      lines: rows.map((line) => ({
        sku: line.sku,
        name: line.name,
        unitPriceCents: line.unit_price_cents,
        quantity: line.quantity,
        lineTotalCents: line.line_total_cents,
      })),
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      shippingCents: row.shipping_cents,
      taxCents: row.tax_cents,
      totalCents: row.total_cents,
      paymentId: row.payment_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async inTransaction<T>(work: (tx: PoolClient) => Promise<T>): Promise<T> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      const result = await work(tx);
      await tx.query('COMMIT');
      return result;
    } catch (error) {
      await tx.query('ROLLBACK');
      throw error;
    } finally {
      tx.release();
    }
  }
}
