import { randomUUID } from 'node:crypto';
import type { CartLine } from '../../src/domain/pricing';

/**
 * Test data builders: each test states only the fields it cares about,
 * and gets valid defaults for everything else.
 */

export interface OrderRequestBody {
  customerId: string;
  items: { sku: string; quantity: number }[];
  couponCode?: string;
  paymentToken: string;
}

class OrderRequestBuilder {
  private body: OrderRequestBody = { customerId: 'cus_test', items: [], paymentToken: 'tok_visa' };

  withItem(sku: string, quantity = 1): this {
    this.body.items.push({ sku, quantity });
    return this;
  }

  withCoupon(code: string): this {
    this.body.couponCode = code;
    return this;
  }

  forCustomer(customerId: string): this {
    this.body.customerId = customerId;
    return this;
  }

  payingWith(paymentToken: string): this {
    this.body.paymentToken = paymentToken;
    return this;
  }

  build(): OrderRequestBody {
    const items = this.body.items.length > 0 ? this.body.items : [{ sku: 'CB-003', quantity: 1 }];
    return structuredClone({ ...this.body, items });
  }
}

export const anOrderRequest = () => new OrderRequestBuilder();

export const aCartLine = (overrides: Partial<CartLine> = {}): CartLine => ({
  sku: `SKU-${randomUUID().slice(0, 8)}`,
  name: 'Test product',
  unitPriceCents: 1_000,
  quantity: 1,
  ...overrides,
});

export const anIdempotencyKey = () => `test-${randomUUID()}`;
