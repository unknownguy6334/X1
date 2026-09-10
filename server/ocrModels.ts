import { ThinkingLevel } from '@google/genai';

export const MODEL_REGISTRY = [
  { id: 'gemini-3.8-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW, timeoutMs: 26_000, attempts: 2 },
  { id: 'gemini-3.7-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW, timeoutMs: 16_000, attempts: 1 },
  { id: 'gemini-3.6-flash', single: ThinkingLevel.LOW, multi: ThinkingLevel.LOW, timeoutMs: 12_000, attempts: 1 },
] as const;

export const MODEL_REGISTRY_MAP = new Map(MODEL_REGISTRY.map((model) => [model.id, model]));
export const modelAllowed = (id: string): boolean => MODEL_REGISTRY_MAP.has(id);
