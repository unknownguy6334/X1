export interface OperationErrorShape { code: string; message: string; retryable: boolean; retryAfterMs?: number; requestId?: string; }
export class DomainOperationError extends Error implements OperationErrorShape {
  code: string; retryable: boolean; retryAfterMs?: number; requestId?: string;
  constructor(shape: OperationErrorShape) { super(shape.message); this.name = 'DomainOperationError'; this.code = shape.code; this.retryable = shape.retryable; this.retryAfterMs = shape.retryAfterMs; this.requestId = shape.requestId; }
}
