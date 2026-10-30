import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/domain/errors';
import { MAX_LINES_PER_ORDER, quote } from '../../src/domain/pricing';
import { aCartLine } from '../support/builders';

const line = (unitPriceCents: number, quantity = 1) => aCartLine({ unitPriceCents, quantity });

/** Asserts the thrown error is a DomainError with the given code. */
function expectDomainError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  expect.fail(`expected DomainError ${code}, but nothing was thrown`);
}

describe('quote', () => {
  // Worked examples double as documentation of the pricing rules.
  it.each([
    {
      name: 'small order pays shipping; 8 % tax rounds to the cent',
      cart: [line(999)],
      coupon: undefined,
      expected: { subtotal: 999, discount: 0, shipping: 499, tax: 80, total: 1_578 },
    },
    {
      name: 'exactly the free-shipping threshold ships free',
      cart: [line(2_500, 2)],
      coupon: undefined,
      expected: { subtotal: 5_000, discount: 0, shipping: 0, tax: 400, total: 5_400 },
    },
    {
      name: 'one cent under the threshold pays shipping',
      cart: [line(4_999)],
      coupon: undefined,
      expected: { subtotal: 4_999, discount: 0, shipping: 499, tax: 400, total: 5_898 },
    },
    {
      name: 'SAVE10 can push an order back under the free-shipping threshold',
      cart: [line(5_000)],
      coupon: 'SAVE10',
      expected: { subtotal: 5_000, discount: 500, shipping: 499, tax: 360, total: 5_359 },
    },
    {
      name: 'FLAT5 applies at exactly its minimum subtotal',
      cart: [line(1_000, 2)],
      coupon: 'FLAT5',
      expected: { subtotal: 2_000, discount: 500, shipping: 499, tax: 120, total: 2_119 },
    },
    {
      name: 'FREESHIP removes shipping but not tax',
      cart: [line(1_000)],
      coupon: 'FREESHIP',
      expected: { subtotal: 1_000, discount: 0, shipping: 0, tax: 80, total: 1_080 },
    },
    {
      name: 'several lines are summed before any rule applies',
      cart: [line(8_900), line(2_450, 2), line(999, 3)],
      coupon: 'SAVE10',
      expected: { subtotal: 16_797, discount: 1_680, shipping: 0, tax: 1_209, total: 16_326 },
    },
  ])('$name', ({ cart, coupon, expected }) => {
    const q = quote(cart, coupon);
    expect({
      subtotal: q.subtotalCents,
      discount: q.discountCents,
      shipping: q.shippingCents,
      tax: q.taxCents,
      total: q.totalCents,
    }).toEqual(expected);
  });

  it('prices each line as unit price times quantity', () => {
    const q = quote([aCartLine({ sku: 'A', unitPriceCents: 250, quantity: 4 })]);
    expect(q.lines).toEqual([expect.objectContaining({ sku: 'A', lineTotalCents: 1_000 })]);
  });

  it('normalises the coupon code', () => {
    expect(quote([line(1_000)], '  save10 ').couponCode).toBe('SAVE10');
  });

  it.each([undefined, null, ''])('treats a coupon of %j as no coupon', (coupon) => {
    const q = quote([line(1_000)], coupon);
    expect(q.couponCode).toBeNull();
    expect(q.discountCents).toBe(0);
  });

  describe('rejects', () => {
    it('an unknown coupon', () => {
      expectDomainError(() => quote([line(1_000)], 'BOGUS'), 'invalid_coupon');
    });

    it('FLAT5 one cent under its minimum', () => {
      expectDomainError(() => quote([line(1_999)], 'FLAT5'), 'coupon_not_applicable');
    });

    it('an empty cart', () => {
      expectDomainError(() => quote([]), 'empty_order');
    });

    it('more lines than allowed', () => {
      const cart = Array.from({ length: MAX_LINES_PER_ORDER + 1 }, () => line(100));
      expectDomainError(() => quote(cart), 'too_many_lines');
    });

    it('the same SKU twice', () => {
      const cart = [aCartLine({ sku: 'A' }), aCartLine({ sku: 'A' })];
      expectDomainError(() => quote(cart), 'duplicate_sku');
    });

    it.each([0, 11, 1.5, -1])('a quantity of %s', (quantity) => {
      expectDomainError(() => quote([line(100, quantity)]), 'invalid_quantity');
    });

    it('a negative unit price', () => {
      expect(() => quote([line(-1)])).toThrow(RangeError);
    });
  });

  it.each([1, 10])('accepts the boundary quantity %s', (quantity) => {
    expect(quote([line(100, quantity)]).lines[0]!.quantity).toBe(quantity);
  });

  it('accepts exactly the maximum number of lines', () => {
    const cart = Array.from({ length: MAX_LINES_PER_ORDER }, () => line(100));
    expect(quote(cart).lines).toHaveLength(MAX_LINES_PER_ORDER);
  });
});
