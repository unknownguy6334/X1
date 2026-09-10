import type { GoogleGenAI } from '@google/genai';
import type { Section } from '../src/types';
import { runOcrWithModelFallback } from './ocrModelFallback';
import { structuredServerLog } from './observability';
import { parseOcrJsonPayload, validateOcrModelShape } from '../src/utils/ocrApiContract';
import { adaptLegacyOcrPayload, canonicalToAppSections, modelOutputToCanonical } from '../src/utils/ocrExtractionCore';

export interface OcrCorpusImage { data: string; mimeType: string; sourceIndex?: number; }

/** Route-independent OCR corpus orchestration. The HTTP route only validates transport concerns. */
export async function extractOcrCorpus(options: {
  ai: GoogleGenAI;
  prompt: string;
  corpusImages: OcrCorpusImage[];
  corpusIndex: number;
  clientSignal?: AbortSignal;
  ocrRunId?: string;
  markModelSuccess: (modelId: string) => void;
}): Promise<Section[]> {
  const { ai, prompt, corpusImages, corpusIndex, clientSignal, ocrRunId, markModelSuccess } = options;
  const contents = [
    ...corpusImages.map((img) => ({ inlineData: { data: img.data, mimeType: img.mimeType || 'image/jpeg' } })),
    "Extract all course codes, course titles, section codes, credits, and weekly class meeting times (day, start time, end time, session type) from the provided schedule screenshot(s). Follow the system instructions and output pure JSON with the key 'sections'. If no courses or meeting times are visible, return {\"sections\": []}.",
  ];
  let hadModelResponse = false;
  let hadUnparseableResponse = false;
  const result = await runOcrWithModelFallback<Section[]>({
    multi: corpusImages.length > 1,
    parentSignal: clientSignal,
    execute: ({ modelId, thinkingLevel }, signal) => ai.models.generateContent({
      model: modelId,
      contents,
      config: { systemInstruction: prompt, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: thinkingLevel as never }, abortSignal: signal },
    }),
    parse: (raw, modelId) => {
      hadModelResponse = true;
      const text = typeof (raw as { text?: unknown })?.text === 'string' ? (raw as { text: string }).text : '';
      const parsed = parseOcrJsonPayload(text);
      if (!parsed) { hadUnparseableResponse = true; return null; }
      const canonicalInput = adaptLegacyOcrPayload(parsed);
      const shape = validateOcrModelShape(canonicalInput);
      if (!shape.valid) {
        hadUnparseableResponse = true;
        structuredServerLog('warn', 'OCR model returned invalid shape', { corpusIndex: corpusIndex + 1, modelId, reasons: shape.reasons });
        return null;
      }
      const sections = canonicalToAppSections(modelOutputToCanonical(canonicalInput, {
        sourceChunkIndex: corpusIndex,
        sourceImageIndexes: corpusImages.map((img) => img.sourceIndex).filter((x): x is number => Number.isInteger(x)),
        model: modelId,
        ocrRunId,
      }));
      markModelSuccess(modelId);
      return sections;
    },
    onModelFailure: (modelId, error) => structuredServerLog('warn', 'OCR model attempt failed', { corpusIndex: corpusIndex + 1, modelId }),
  });
  if (result) {
    structuredServerLog('info', 'OCR corpus extraction completed', { corpusIndex: corpusIndex + 1, model: result.modelId, sections: result.value.length });
    return result.value;
  }
  if (hadModelResponse && hadUnparseableResponse) {
    const error = new Error('MODEL_UNPARSEABLE');
    (error as Error & { reasonCode?: string }).reasonCode = 'MODEL_UNPARSEABLE';
    throw error;
  }
  return [];
}
