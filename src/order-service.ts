import { createHash, randomUUID } from 'node:crypto';
import type { OrderRepository, StoredRequest } from './db/order-repository';
import type { ProductRepository } from './db/product-repository';
import { DomainError } from './domain/errors';
import { CURRENCY } from './domain/money';
import type { Order } from './domain/order';
import { holdsStock, nextStatus, type OrderAction } from './domain/order-status';
import { quote, type CartLine } from './domain/pricing';
import { PaymentsError, type PaymentsGateway } from './payments/payments-client';

export interface PlaceOrderInput {
  customerId: string;
  items: { sku: string; quantity: number }[];
  couponCode?: string | undefined;
  paymentToken: string;
  idempotencyKey: string;
}

export interface PlaceOrderResult {
  /** `true` when the idempotency key was seen before and no new order was created. */
  replayed: boolean;
  order: Order;
}

export interface OrderServiceDeps {
  orders: OrderRepository;
  products: ProductRepository;
  payments: PaymentsGateway;
  /** Injected so tests can freeze time. */
  clock?: () => Date;
  /** Injected so tests can predict ids. */
  newId?: () => string;
}

export class OrderService {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: OrderServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? (() => `ord_${randomUUID()}`);
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const hash = requestHash(input);
    const previous = await this.deps.orders.findByIdempotencyKey(input.idempotencyKey);
    if (previous) return this.replay(previous, hash);

    const products = await this.deps.products.findBySkus(input.items.map((item) => item.sku));
    const cart: CartLine[] = input.items.map((item) => {
      const product = products.get(item.sku);
      if (!product) throw new DomainError('unknown_sku', `Product ${item.sku} does not exist`);
      return {
        sku: product.sku,
        name: product.name,
        unitPriceCents: product.priceCents,
        quantity: item.quantity,
      };
    });

    const now = this.clock().toISOString();
    const order: Order = {
      ...quote(cart, input.couponCode),
      id: this.newId(),
      customerId: input.customerId,
      status: 'PENDING_PAYMENT',
      currency: CURRENCY,
      paymentId: null,
      createdAt: now,
      updatedAt: now,
    };

    const inserted = await this.deps.orders.insertReservingStock({
      order,
      paymentToken: input.paymentToken,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    });
    if (!inserted) {
      // Lost a race with a concurrent request carrying the same key: answer as that request did.
      const winner = await this.deps.orders.findByIdempotencyKey(input.idempotencyKey);
      if (!winner) throw new Error(`Idempotency key ${input.idempotencyKey} vanished`);
      return this.replay(winner, hash);
    }

    return { replayed: false, order: await this.collectPayment(order, input.paymentToken) };
  }

  async getOrder(id: string): Promise<Order> {
    const order = await this.deps.orders.findById(id);
    if (!order) throw new DomainError('order_not_found', `Order ${id} does not exist`, 404);
    return order;
  }

  async ship(id: string): Promise<Order> {
    return this.apply(await this.getOrder(id), 'SHIP');
  }

  async cancel(id: string): Promise<Order> {
    return this.apply(await this.getOrder(id), 'CANCEL');
  }

  private async replay(previous: StoredRequest, hash: string): Promise<PlaceOrderResult> {
    if (previous.requestHash !== hash) {
      throw new DomainError(
        'idempotency_key_reused',
        'This Idempotency-Key was already used with a different request body',
        409,
      );
    }
    // The first attempt could not reach payments: a retry by the client is the moment to try again.
    const order =
      previous.order.status === 'PENDING_PAYMENT'
        ? await this.collectPayment(previous.order, previous.paymentToken)
        : previous.order;
    return { replayed: true, order };
  }

  private async collectPayment(order: Order, paymentToken: string): Promise<Order> {
    let result;
    try {
      result = await this.deps.payments.charge({
        orderId: order.id,
        amountCents: order.totalCents,
        currency: order.currency,
        paymentToken,
        // One key per order: however many times we retry, the customer is charged once.
        idempotencyKey: order.id,
      });
    } catch (error) {
      if (!(error instanceof PaymentsError)) throw error;
      throw new DomainError(
        error.retryable ? 'payment_pending' : 'payments_error',
        error.retryable
          ? 'Payments are temporarily unavailable; retry with the same Idempotency-Key'
          : 'The payments service rejected the request',
        error.retryable ? 503 : 502,
        { orderId: order.id },
      );
    }
    const action = result.status === 'approved' ? 'PAYMENT_APPROVED' : 'PAYMENT_DECLINED';
    return this.apply(order, action, result.paymentId);
  }

  private async apply(order: Order, action: OrderAction, paymentId?: string): Promise<Order> {
    const to = nextStatus(order.status, action);
    const updated = await this.deps.orders.transition(order.id, order.status, to, {
      now: this.clock().toISOString(),
      ...(paymentId ? { paymentId } : {}),
      releaseStock: holdsStock(order.status) && !holdsStock(to),
    });
    if (updated) return updated;

    // Someone else moved the order first. If they got it where we wanted, that is success.
    const current = await this.getOrder(order.id);
    if (current.status === to) return current;
    throw new DomainError(
      'concurrent_update',
      `Order ${order.id} changed to ${current.status} while processing ${action}`,
      409,
    );
  }
}

/** Canonical fingerprint of a request, so a reused Idempotency-Key with a different body is caught. */
export function requestHash(input: PlaceOrderInput): string {
  const canonical = {
    customerId: input.customerId,
    items: [...input.items]
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .map(({ sku, quantity }) => [sku, quantity]),
    couponCode: input.couponCode?.trim().toUpperCase() || null,
    paymentToken: input.paymentToken,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
