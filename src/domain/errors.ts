/**
 * A business rule was violated. `code` is the stable, machine-readable identifier
 * returned to API clients; `status` is the HTTP status the API layer maps it to.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 422,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
