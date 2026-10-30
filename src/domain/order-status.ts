import { DomainError } from './errors';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PAYMENT_FAILED',
  'SHIPPED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ACTIONS = ['PAYMENT_APPROVED', 'PAYMENT_DECLINED', 'SHIP', 'CANCEL'] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** The complete lifecycle. Anything not listed here is an illegal transition. */
const TRANSITIONS: Readonly<Record<OrderStatus, Partial<Record<OrderAction, OrderStatus>>>> = {
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

export function nextStatus(from: OrderStatus, action: OrderAction): OrderStatus {
  const to = TRANSITIONS[from][action];
  if (!to) {
    throw new DomainError('invalid_transition', `Cannot ${action} an order that is ${from}`, 409);
  }
  return to;
}

/** Stock is held while an order can still ship; it goes back on decline or cancel. */
export function holdsStock(status: OrderStatus): boolean {
  return status === 'PENDING_PAYMENT' || status === 'PAID' || status === 'SHIPPED';
}
