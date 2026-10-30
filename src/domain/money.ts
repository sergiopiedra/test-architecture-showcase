/** Money is always an integer number of cents. Floats never touch an amount. */
export type Cents = number;

export const CURRENCY = 'EUR';

/** 1 basis point = 0.01 %, so 800 bp = 8 %. */
export type BasisPoints = number;

export function assertCents(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of cents, got ${value}`);
  }
}

/**
 * `amount * rate`, rounded half-up to the nearest cent, using integer maths only.
 * Example: applyRate(1005, 800) = 80.4 -> 80; applyRate(1000, 125) = 12.5 -> 13.
 */
export function applyRate(amount: Cents, rate: BasisPoints): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(rate) || rate < 0) {
    throw new RangeError(`rate must be a non-negative integer number of basis points, got ${rate}`);
  }
  return Math.floor((amount * rate + 5_000) / 10_000);
}
