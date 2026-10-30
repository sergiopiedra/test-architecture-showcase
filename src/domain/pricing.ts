import { DomainError } from './errors';
import { applyRate, assertCents, type BasisPoints, type Cents } from './money';

export const MAX_QUANTITY_PER_LINE = 10;
export const MAX_LINES_PER_ORDER = 20;
export const SHIPPING_FEE: Cents = 499;
export const FREE_SHIPPING_THRESHOLD: Cents = 5_000;
export const TAX_RATE: BasisPoints = 800;

export interface CartLine {
  sku: string;
  name: string;
  unitPriceCents: Cents;
  quantity: number;
}

export interface PricedLine extends CartLine {
  lineTotalCents: Cents;
}

export interface Quote {
  lines: PricedLine[];
  couponCode: string | null;
  subtotalCents: Cents;
  discountCents: Cents;
  shippingCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
}

type Coupon =
  | { kind: 'percent'; rate: BasisPoints }
  | { kind: 'fixed'; amount: Cents; minSubtotal: Cents }
  | { kind: 'free-shipping' };

export const COUPONS: Readonly<Record<string, Coupon>> = {
  SAVE10: { kind: 'percent', rate: 1_000 },
  FLAT5: { kind: 'fixed', amount: 500, minSubtotal: 2_000 },
  FREESHIP: { kind: 'free-shipping' },
};

/**
 * Prices a cart. Order of operations matters and is part of the contract:
 * subtotal -> coupon discount -> shipping (on the discounted subtotal) -> tax
 * (on the discounted subtotal; shipping is not taxed) -> total.
 */
export function quote(cart: readonly CartLine[], couponCode?: string | null): Quote {
  validateCart(cart);

  const lines = cart.map((line) => ({
    ...line,
    lineTotalCents: line.unitPriceCents * line.quantity,
  }));
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  const code = couponCode ? couponCode.trim().toUpperCase() : null;
  const coupon = code ? COUPONS[code] : undefined;
  if (code && !coupon) {
    throw new DomainError('invalid_coupon', `Coupon ${code} does not exist`);
  }

  const discount = coupon ? discountFor(coupon, subtotal) : 0;
  const discounted = subtotal - discount;
  const freeShipping = coupon?.kind === 'free-shipping' || discounted >= FREE_SHIPPING_THRESHOLD;
  const shipping = freeShipping ? 0 : SHIPPING_FEE;
  const tax = applyRate(discounted, TAX_RATE);

  return {
    lines,
    couponCode: code,
    subtotalCents: subtotal,
    discountCents: discount,
    shippingCents: shipping,
    taxCents: tax,
    totalCents: discounted + shipping + tax,
  };
}

function discountFor(coupon: Coupon, subtotal: Cents): Cents {
  switch (coupon.kind) {
    case 'percent':
      return applyRate(subtotal, coupon.rate);
    case 'fixed':
      if (subtotal < coupon.minSubtotal) {
        throw new DomainError(
          'coupon_not_applicable',
          `Coupon requires a subtotal of at least ${coupon.minSubtotal} cents`,
        );
      }
      return Math.min(coupon.amount, subtotal);
    case 'free-shipping':
      return 0;
  }
}

function validateCart(cart: readonly CartLine[]): void {
  if (cart.length === 0) {
    throw new DomainError('empty_order', 'An order needs at least one line');
  }
  if (cart.length > MAX_LINES_PER_ORDER) {
    throw new DomainError(
      'too_many_lines',
      `An order can have at most ${MAX_LINES_PER_ORDER} lines`,
    );
  }
  const seen = new Set<string>();
  for (const line of cart) {
    if (seen.has(line.sku)) {
      throw new DomainError('duplicate_sku', `SKU ${line.sku} appears more than once`);
    }
    seen.add(line.sku);
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_QUANTITY_PER_LINE
    ) {
      throw new DomainError(
        'invalid_quantity',
        `Quantity for ${line.sku} must be between 1 and ${MAX_QUANTITY_PER_LINE}`,
      );
    }
    assertCents(line.unitPriceCents, `unit price of ${line.sku}`);
  }
}
