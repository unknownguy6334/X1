import { safeStorage, createStorageEnvelope, parseStorageEnvelope } from '../utils/safeStorage';
import { sanitizePendingReviewSections, sanitizeRecoveredManualForm, readLatestPersisted } from '../features/courseBuilder/model';
import type { ManualFormState } from '../features/courseBuilder/model';
import type { Section } from '../types';
import { createGenerationId } from '../domain/workflow';

export const DRAFT_SCHEMA_VERSION = 'v4';
export const DRAFT_SCHEMA_MIGRATIONS: Record<string, string> = { v1: DRAFT_SCHEMA_VERSION, v2: DRAFT_SCHEMA_VERSION, v3: DRAFT_SCHEMA_VERSION };

export const WORKFLOW_DRAFT_KEYS = {
  pendingReview: 'gadwal_pending_review_v4',
  legacyPendingReview: 'gadwal_pending_review_v3',
  legacyPendingReviewV2: 'gadwal_pending_review_v2',
  legacyPendingReviewV1: 'gadwal_pending_review_v1',
  manualForms: 'gadwal_manual_forms_v1',
  activeTab: 'gadwal_active_tab_v1',
} as const;

export interface PendingReviewEnvelope {
  reviewGenerationId: string;
  createdAt: number;
  sourceFileCount: number;
  sourceFileFingerprints: string[];
  ocrRunId?: string;
  evidenceVersion: string;
  reviewSource: 'live' | 'recovered';
  sections: Section[];
}

export interface PersistenceWriteResult { durableSaved: boolean; sessionSaved: boolean; usedSessionFallback: boolean; }

function hasManualFormWork(forms: ManualFormState[]): boolean {
  return forms.some((f) => Boolean(f.name.trim() || f.courseCode.trim() || f.sectionCode.trim() || f.credits.trim() || f.instructor?.trim() || f.sessions.some((session) => Boolean(session.day || session.start || session.end || session.customType?.trim()))));
}

function migratePendingEnvelope(value: unknown): PendingReviewEnvelope | null {
  if (Array.isArray(value)) return { reviewGenerationId: createGenerationId('review-recovered'), createdAt: Date.now(), sourceFileCount: 0, sourceFileFingerprints: [], evidenceVersion: 'legacy', reviewSource: 'recovered', sections: sanitizePendingReviewSections(value) };
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Partial<PendingReviewEnvelope>;
  if (!Array.isArray(envelope.sections)) return null;
  const sections = sanitizePendingReviewSections(envelope.sections);
  return {
    reviewGenerationId: typeof envelope.reviewGenerationId === 'string' && envelope.reviewGenerationId.trim() ? envelope.reviewGenerationId : createGenerationId('review-recovered'),
    createdAt: Number.isFinite(envelope.createdAt) ? Number(envelope.createdAt) : Date.now(),
    sourceFileCount: Number.isInteger(envelope.sourceFileCount) && Number(envelope.sourceFileCount) >= 0 ? Number(envelope.sourceFileCount) : 0,
    sourceFileFingerprints: Array.isArray(envelope.sourceFileFingerprints) ? envelope.sourceFileFingerprints.filter((v): v is string => typeof v === 'string').slice(0, 50) : [],
    ocrRunId: typeof envelope.ocrRunId === 'string' ? envelope.ocrRunId : undefined,
    evidenceVersion: typeof envelope.evidenceVersion === 'string' ? envelope.evidenceVersion : 'legacy',
    reviewSource: envelope.reviewSource === 'live' ? 'live' : 'recovered',
    sections,
  };
}

export function readPendingReview(): Section[] | null {
  const candidates: Array<{ updatedAt: number; sections: Section[] }> = [];
  const keys = [WORKFLOW_DRAFT_KEYS.pendingReview, WORKFLOW_DRAFT_KEYS.legacyPendingReview, WORKFLOW_DRAFT_KEYS.legacyPendingReviewV2, WORKFLOW_DRAFT_KEYS.legacyPendingReviewV1];
  for (const key of keys) {
    const localRaw = safeStorage.getItem(key);
    const sessionRaw = safeStorage.sessionGetItem(key);
    for (const raw of [localRaw, sessionRaw]) {
      if (!raw) continue;
      const envelope = parseStorageEnvelope<unknown>(raw);
      const parsed = envelope?.data ?? (() => { try { return JSON.parse(raw); } catch { return null; } })();
      const source = migratePendingEnvelope(parsed);
      if (source) candidates.push({ updatedAt: envelope?.updatedAt ?? 0, sections: source.sections });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0].sections;
}

export function savePendingReview(envelope: PendingReviewEnvelope): PersistenceWriteResult {
  const normalized: PendingReviewEnvelope = { ...envelope, evidenceVersion: envelope.evidenceVersion || 'v1', reviewSource: envelope.reviewSource || 'live' };
  const payload = JSON.stringify(createStorageEnvelope(normalized, DRAFT_SCHEMA_VERSION));
  const durableSaved = safeStorage.setItem(WORKFLOW_DRAFT_KEYS.pendingReview, payload);
  const sessionSaved = safeStorage.sessionSetItem(WORKFLOW_DRAFT_KEYS.pendingReview, payload);
  if (durableSaved || sessionSaved) {
    [WORKFLOW_DRAFT_KEYS.legacyPendingReview, WORKFLOW_DRAFT_KEYS.legacyPendingReviewV2, WORKFLOW_DRAFT_KEYS.legacyPendingReviewV1].forEach((key) => {
      safeStorage.removeItem(key);
      safeStorage.sessionRemoveItem(key);
    });
  }
  return { durableSaved, sessionSaved, usedSessionFallback: !durableSaved && sessionSaved };
}

export function clearPendingReview(): void {
  [WORKFLOW_DRAFT_KEYS.pendingReview, WORKFLOW_DRAFT_KEYS.legacyPendingReview, WORKFLOW_DRAFT_KEYS.legacyPendingReviewV2, WORKFLOW_DRAFT_KEYS.legacyPendingReviewV1].forEach((key) => { safeStorage.removeItem(key); safeStorage.sessionRemoveItem(key); });
}

export function readManualForms(): ManualFormState[] | null {
  return readLatestPersisted(WORKFLOW_DRAFT_KEYS.manualForms, (value) => {
    if (!Array.isArray(value)) return null;
    const forms = value.flatMap((f) => { const form = sanitizeRecoveredManualForm(f); return form ? [form] : []; });
    return forms.length ? forms : null;
  });
}

export function saveManualForms(forms: ManualFormState[]): PersistenceWriteResult {
  if (!hasManualFormWork(forms)) { clearManualForms(); return { durableSaved: true, sessionSaved: true, usedSessionFallback: false }; }
  const payload = JSON.stringify(createStorageEnvelope(forms, DRAFT_SCHEMA_VERSION));
  const durableSaved = safeStorage.setItem(WORKFLOW_DRAFT_KEYS.manualForms, payload);
  const sessionSaved = safeStorage.sessionSetItem(WORKFLOW_DRAFT_KEYS.manualForms, payload);
  return { durableSaved, sessionSaved, usedSessionFallback: !durableSaved && sessionSaved };
}

export function clearManualForms(): void { safeStorage.removeItem(WORKFLOW_DRAFT_KEYS.manualForms); safeStorage.sessionRemoveItem(WORKFLOW_DRAFT_KEYS.manualForms); }
export function clearAllWorkflowDrafts(): void { clearPendingReview(); clearManualForms(); }
export function clearAllWorkflowPersistence(): void { clearAllWorkflowDrafts(); safeStorage.removeItem(WORKFLOW_DRAFT_KEYS.activeTab); safeStorage.sessionRemoveItem(WORKFLOW_DRAFT_KEYS.activeTab); }
