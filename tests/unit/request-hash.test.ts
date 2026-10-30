import { describe, expect, it } from 'vitest';
import { requestHash, type PlaceOrderInput } from '../../src/order-service';

const base: PlaceOrderInput = {
  customerId: 'cus_1',
  items: [
    { sku: 'A', quantity: 1 },
    { sku: 'B', quantity: 2 },
  ],
  couponCode: 'SAVE10',
  paymentToken: 'tok_visa',
  idempotencyKey: 'key-1',
};

describe('requestHash', () => {
  it('ignores item order, coupon case and the idempotency key itself', () => {
    const equivalent = {
      ...base,
      items: [...base.items].reverse(),
      couponCode: ' save10 ',
      idempotencyKey: 'key-2',
    };
    expect(requestHash(equivalent)).toBe(requestHash(base));
  });

  it('treats a missing and an empty coupon the same', () => {
    expect(requestHash({ ...base, couponCode: undefined })).toBe(
      requestHash({ ...base, couponCode: '' }),
    );
  });

  it.each([
    ['customer', { customerId: 'cus_2' }],
    [
      'quantity',
      {
        items: [
          { sku: 'A', quantity: 1 },
          { sku: 'B', quantity: 3 },
        ],
      },
    ],
    ['items', { items: [{ sku: 'A', quantity: 1 }] }],
    ['coupon', { couponCode: 'FREESHIP' }],
    ['payment token', { paymentToken: 'tok_declined' }],
  ])('changes when the %s changes', (_field, change) => {
    expect(requestHash({ ...base, ...change })).not.toBe(requestHash(base));
  });
});
