import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';

export interface ChargeRequest {
  orderId: string;
  amountCents: number;
  currency: string;
  paymentToken: string;
  /** Sent as the Idempotency-Key header; reused on every retry so we never double charge. */
  idempotencyKey: string;
}

export interface ChargeResult {
  paymentId: string;
  status: 'approved' | 'declined';
  declineReason: string | null;
}

/** The port the order service depends on. Tests swap in a fake; production uses HTTP. */
export interface PaymentsGateway {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

/** The payments service could not give us an answer. `retryable` says whether trying later can help. */
export class PaymentsError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PaymentsError';
  }
}

// Validating the response turns silent provider drift into a loud, specific error.
const PaymentResponse = z.object({
  id: z.string().min(1),
  status: z.enum(['approved', 'declined']),
  amountCents: z.number().int(),
  currency: z.string(),
  declineReason: z.string().optional(),
});

export interface HttpPaymentsClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** First retry waits this long; each later retry doubles it. */
  backoffMs?: number;
  fetch?: typeof fetch;
}

export class HttpPaymentsClient implements PaymentsGateway {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: HttpPaymentsClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.backoffMs = options.backoffMs ?? 200;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    let lastError: PaymentsError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1) await sleep(this.backoffMs * 2 ** (attempt - 2));
      try {
        return await this.attempt(request);
      } catch (error) {
        if (!(error instanceof PaymentsError) || !error.retryable) throw error;
        lastError = error;
      }
    }
    throw new PaymentsError(
      `Payments unavailable after ${this.maxAttempts} attempts: ${lastError?.message}`,
      true,
      { cause: lastError },
    );
  }

  private async attempt(request: ChargeRequest): Promise<ChargeResult> {
    let response: Response;
    try {
      response = await this.fetch(new URL('/v1/payments', this.options.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': request.idempotencyKey,
        },
        body: JSON.stringify({
          orderId: request.orderId,
          amountCents: request.amountCents,
          currency: request.currency,
          paymentToken: request.paymentToken,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'network error';
      throw new PaymentsError(`Payments request ${reason}`, true, { cause: error });
    }

    if (response.status >= 500 || response.status === 429) {
      throw new PaymentsError(`Payments responded ${response.status}`, true);
    }
    if (response.status !== 201) {
      // A 4xx means we sent something the provider rejects: retrying will not fix it.
      throw new PaymentsError(`Payments rejected the request with ${response.status}`, false);
    }

    const parsed = PaymentResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new PaymentsError(`Unexpected payments response: ${parsed.error.message}`, false);
    }
    return {
      paymentId: parsed.data.id,
      status: parsed.data.status,
      declineReason: parsed.data.declineReason ?? null,
    };
  }
}
