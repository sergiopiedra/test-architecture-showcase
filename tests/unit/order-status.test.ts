import { describe, expect, it } from 'vitest';
import {
  holdsStock,
  nextStatus,
  ORDER_ACTIONS,
  ORDER_STATUSES,
  type OrderAction,
  type OrderStatus,
} from '../../src/domain/order-status';

/**
 * The lifecycle, written out independently of the implementation. Every
 * (status, action) pair is tested: 5 statuses x 4 actions = 20 cases, so a
 * transition added or removed by accident cannot slip through.
 */
const ALLOWED: Record<OrderStatus, Partial<Record<OrderAction, OrderStatus>>> = {
  PENDING_PAYMENT: {
    PAYMENT_APPROVED: 'PAID',
    PAYMENT_DECLINED: 'PAYMENT_FAILED',
    CANCEL: 'CANCELLED',
  },
  PAID: { SHIP: 'SHIPPED', CANCEL: 'CANCELLED' },
  PAYMENT_FAILED: { CANCEL: 'CANCELLED' },
  SHIPPED: {},
  CANCELLED: {},
};

const everyPair = ORDER_STATUSES.flatMap((from) =>
  ORDER_ACTIONS.map((action) => ({ from, action, to: ALLOWED[from][action] })),
);

describe('nextStatus', () => {
  it.each(everyPair.filter((c) => c.to))('$from + $action -> $to', ({ from, action, to }) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  it.each(everyPair.filter((c) => !c.to))(
    '$from + $action is rejected with 409',
    ({ from, action }) => {
      expect(() => nextStatus(from, action)).toThrow(
        expect.objectContaining({ code: 'invalid_transition', status: 409 }),
      );
    },
  );

  it('covers all 20 combinations', () => {
    expect(everyPair).toHaveLength(ORDER_STATUSES.length * ORDER_ACTIONS.length);
  });
});

describe('holdsStock', () => {
  it.each([
    ['PENDING_PAYMENT', true],
    ['PAID', true],
    ['SHIPPED', true],
    ['PAYMENT_FAILED', false],
    ['CANCELLED', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(holdsStock(status)).toBe(expected);
  });
});
