/**
 * Property-based tests: instead of picking examples, state rules that must hold for
 * *every* cart and let fast-check search for a counterexample (and shrink it to the
 * smallest one if it finds one). Re-run a failure with the seed fast-check prints.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FREE_SHIPPING_THRESHOLD,
  MAX_LINES_PER_ORDER,
  MAX_QUANTITY_PER_LINE,
  quote,
  TAX_RATE,
  type CartLine,
} from '../../src/domain/pricing';

const cartLine: fc.Arbitrary<CartLine> = fc.record({
  sku: fc.stringMatching(/^[A-Z]{2}-\d{3}$/),
  name: fc.constant('Product'),
  unitPriceCents: fc.integer({ min: 1, max: 500_000 }),
  quantity: fc.integer({ min: 1, max: MAX_QUANTITY_PER_LINE }),
});

const cart = fc.uniqueArray(cartLine, {
  minLength: 1,
  maxLength: MAX_LINES_PER_ORDER,
  selector: (line) => line.sku,
});

// FLAT5 is left out: it throws below its minimum, which pricing.test.ts covers.
const coupon = fc.constantFrom(undefined, 'SAVE10', 'FREESHIP');

describe('quote invariants', () => {
  it('total is exactly discounted subtotal + shipping + tax', () => {
    fc.assert(
      fc.property(cart, coupon, (lines, code) => {
        const q = quote(lines, code);
        expect(q.totalCents).toBe(q.subtotalCents - q.discountCents + q.shippingCents + q.taxCents);
      }),
    );
  });

  it('every amount is a non-negative integer number of cents', () => {
    fc.assert(
      fc.property(cart, coupon, (lines, code) => {
        const q = quote(lines, code);
        for (const amount of [q.subtotalCents, q.discountCents, q.shippingCents, q.taxCents]) {
          expect(Number.isSafeInteger(amount) && amount >= 0).toBe(true);
        }
      }),
    );
  });

  it('a discount never exceeds the subtotal', () => {
    fc.assert(
      fc.property(cart, coupon, (lines, code) => {
        const q = quote(lines, code);
        expect(q.discountCents).toBeLessThanOrEqual(q.subtotalCents);
      }),
    );
  });

  it('tax is within half a cent of the exact rate on the discounted subtotal', () => {
    fc.assert(
      fc.property(cart, coupon, (lines, code) => {
        const q = quote(lines, code);
        const exactTimes10k = (q.subtotalCents - q.discountCents) * TAX_RATE;
        expect(Math.abs(q.taxCents * 10_000 - exactTimes10k)).toBeLessThanOrEqual(5_000);
      }),
    );
  });

  it('shipping is free exactly when FREESHIP is used or the threshold is met', () => {
    fc.assert(
      fc.property(cart, coupon, (lines, code) => {
        const q = quote(lines, code);
        const expectFree =
          code === 'FREESHIP' || q.subtotalCents - q.discountCents >= FREE_SHIPPING_THRESHOLD;
        expect(q.shippingCents === 0).toBe(expectFree);
      }),
    );
  });

  it('the order of lines does not change the price', () => {
    fc.assert(
      fc.property(
        cart.chain((lines) =>
          fc.tuple(fc.constant(lines), fc.shuffledSubarray(lines, { minLength: lines.length })),
        ),
        coupon,
        ([lines, shuffled], code) => {
          expect(quote(shuffled, code).totalCents).toBe(quote(lines, code).totalCents);
        },
      ),
    );
  });

  it('adding one more unit never makes the subtotal cheaper', () => {
    fc.assert(
      fc.property(cart, fc.nat(), (lines, pick) => {
        const index = pick % lines.length;
        fc.pre(lines[index]!.quantity < MAX_QUANTITY_PER_LINE);
        const bigger = lines.map((line, i) =>
          i === index ? { ...line, quantity: line.quantity + 1 } : line,
        );
        expect(quote(bigger).subtotalCents).toBeGreaterThan(quote(lines).subtotalCents);
      }),
    );
  });
});
