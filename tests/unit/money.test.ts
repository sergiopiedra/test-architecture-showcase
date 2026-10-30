import { describe, expect, it } from 'vitest';
import { applyRate, assertCents } from '../../src/domain/money';

describe('applyRate', () => {
  it.each([
    { amount: 0, rate: 800, expected: 0 },
    { amount: 1_000, rate: 0, expected: 0 }, // a 0 % rate is valid
    { amount: 1_000, rate: 800, expected: 80 },
    { amount: 1_005, rate: 800, expected: 80 }, // 80.40
    { amount: 1_007, rate: 800, expected: 81 }, // 80.56
    { amount: 1_000, rate: 125, expected: 13 }, // 12.5 rounds half-up
    { amount: 1, rate: 5_000, expected: 1 }, // 0.5 rounds half-up
    { amount: 1, rate: 4_999, expected: 0 }, // 0.4999 rounds down
    { amount: 12_345, rate: 10_000, expected: 12_345 }, // 100 %
  ])('$amount cents at $rate bp is $expected cents', ({ amount, rate, expected }) => {
    expect(applyRate(amount, rate)).toBe(expected);
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an amount of %s', (amount) => {
    expect(() => applyRate(amount, 800)).toThrow(RangeError);
  });

  it.each([-1, 0.5])('rejects a rate of %s', (rate) => {
    expect(() => applyRate(1_000, rate)).toThrow(/rate must be/);
  });
});

describe('assertCents', () => {
  it('accepts zero and positive integers', () => {
    expect(() => assertCents(0)).not.toThrow();
    expect(() => assertCents(999)).not.toThrow();
  });

  it('calls the value "amount" unless told otherwise', () => {
    expect(() => assertCents(-5)).toThrow(/^amount must be/);
  });

  it('names the offending value in the error', () => {
    expect(() => assertCents(-5, 'unit price')).toThrow(
      'unit price must be a non-negative integer number of cents, got -5',
    );
  });
});
