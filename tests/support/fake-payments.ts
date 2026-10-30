import {
  PaymentsError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentsGateway,
} from '../../src/payments/payments-client';

type Outcome = ChargeResult | PaymentsError;

/**
 * In-memory payments gateway. Behaves like the sandbox (tok_declined is declined,
 * everything else approved, same idempotency key -> same payment) unless a test
 * scripts the next outcomes explicitly. Every call is recorded for assertions.
 */
export class FakePayments implements PaymentsGateway {
  readonly calls: ChargeRequest[] = [];
  private readonly scripted: Outcome[] = [];
  private readonly byKey = new Map<string, ChargeResult>();

  /** Queue outcomes for the next calls, in order. */
  willRespond(...outcomes: Outcome[]): this {
    this.scripted.push(...outcomes);
    return this;
  }

  willBeUnavailable(times = 1): this {
    for (let i = 0; i < times; i++) {
      this.scripted.push(new PaymentsError('Payments responded 503', true));
    }
    return this;
  }

  /** Distinct idempotency keys seen: the number of customers actually charged. */
  get distinctCharges(): number {
    return new Set(this.calls.map((call) => call.idempotencyKey)).size;
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(request);
    const outcome = this.outcomeFor(request);
    return outcome instanceof PaymentsError ? Promise.reject(outcome) : Promise.resolve(outcome);
  }

  private outcomeFor(request: ChargeRequest): Outcome {
    const next = this.scripted.shift();
    if (next) return next;

    const previous = this.byKey.get(request.idempotencyKey);
    if (previous) return previous;
    const paymentId = `pay_${this.byKey.size + 1}`;
    const result: ChargeResult =
      request.paymentToken === 'tok_declined'
        ? { paymentId, status: 'declined', declineReason: 'insufficient_funds' }
        : { paymentId, status: 'approved', declineReason: null };
    this.byKey.set(request.idempotencyKey, result);
    return result;
  }
}
