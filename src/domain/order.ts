import type { OrderStatus } from './order-status';
import type { Quote } from './pricing';

export interface Order extends Quote {
  id: string;
  customerId: string;
  status: OrderStatus;
  currency: string;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
}
