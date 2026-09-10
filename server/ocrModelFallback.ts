import { MODEL_REGISTRY } from './ocrModels';
import type { ThinkingLevel } from '@google/genai';
import { callOcrModelWithRetry } from '../src/utils/ocrApiContract';
import { OCR_PROVIDER_TOTAL_BUDGET_MS } from '../src/utils/ocrTimeout';

export interface OcrModelAttemptContext {
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface OcrFallbackResult<T> {
  value: T;
  modelId: string;
}

export async function runOcrWithModelFallback<T>(options: {
  parentSignal?: AbortSignal;
  multi: boolean;
  execute: (ctx: OcrModelAttemptContext, signal: AbortSignal) => Promise<unknown>;
  parse: (raw: unknown, modelId: string) => T | null;
  onModelFailure?: (modelId: string, error: unknown) => void;
}): Promise<OcrFallbackResult<T> | null> {
  const deadline = Date.now() + OCR_PROVIDER_TOTAL_BUDGET_MS;
  let lastError: unknown = null;
  for (const model of MODEL_REGISTRY) {
    if (options.parentSignal?.aborted) throw new Error('CLIENT_ABORTED');
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 500) break;
    const timeoutMs = Math.min(model.timeoutMs, Math.max(1000, remainingMs - 250));
    try {
      const response = await callOcrModelWithRetry(
        (signal) => options.execute({ modelId: model.id, thinkingLevel: options.multi ? model.multi : model.single }, signal),
        { timeoutMs, attempts: Math.min(model.attempts, timeoutMs >= 22_000 ? 2 : 1), parentSignal: options.parentSignal },
      );
      const parsed = options.parse(response, model.id);
      if (parsed !== null) return { value: parsed, modelId: model.id };
    } catch (error) {
      if (options.parentSignal?.aborted || (error instanceof Error && error.message === 'CLIENT_ABORTED')) throw new Error('CLIENT_ABORTED');
      lastError = error;
      options.onModelFailure?.(model.id, error);
    }
  }
  if (lastError) throw lastError;
  return null;
}
