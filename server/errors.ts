export interface SafeServerError {
  name: string;
  message: string;
  code?: string;
  status?: number;
  retryAfter?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function serializeServerError(error: unknown): SafeServerError {
  if (error instanceof Error) {
    const record = error as Error & Record<string, unknown>;
    const status = typeof record.status === 'number' && Number.isFinite(record.status) ? record.status : undefined;
    const retryAfter = typeof record.retryAfter === 'number' && Number.isFinite(record.retryAfter) ? record.retryAfter : undefined;
    const code = typeof record.code === 'string' ? record.code.slice(0, 80) : typeof record.reasonCode === 'string' ? record.reasonCode.slice(0, 80) : undefined;
    return { name: error.name || 'Error', message: error.message.slice(0, 500), code, status, retryAfter };
  }
  if (isRecord(error)) {
    const message = typeof error.message === 'string' ? error.message.slice(0, 500) : 'Something went wrong. Try again.';
    const code = typeof error.code === 'string' ? error.code.slice(0, 80) : typeof error.reasonCode === 'string' ? error.reasonCode.slice(0, 80) : undefined;
    const status = typeof error.status === 'number' && Number.isFinite(error.status) ? error.status : undefined;
    const retryAfter = typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter) ? error.retryAfter : undefined;
    return { name: typeof error.name === 'string' ? error.name.slice(0, 80) : 'Error', message, code, status, retryAfter };
  }
  return { name: 'Error', message: typeof error === 'string' ? error.slice(0, 500) : 'Something went wrong. Try again.' };
}
