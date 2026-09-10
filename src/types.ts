export type DayOfWeek = 'SAT' | 'SUN' | 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI';

export type SessionType = 'Lecture' | 'Section' | 'Lab' | 'Online' | 'Tutorial' | 'Discussion' | 'Recitation' | 'Seminar' | 'Workshop' | 'Other' | 'Custom';

export interface Session {
  id?: string;
  day: DayOfWeek;
  start: string; // "HH:MM" 24h format, e.g. "09:00"
  end: string;   // "HH:MM" 24h format, e.g. "10:30"
  type?: SessionType; // Normalized university meeting type; the review UI also supports a user-defined Custom value.
  customType?: string; // User-defined meeting type when type is Custom.
  rawType?: string; // Original untrusted/source meeting type, when available.
  rawStart?: string;
  rawEnd?: string;
  sourceNote?: string;
  sourceEvidence?: { sourceImageIndexes?: number[]; sourceRecordIndex?: number; confidence?: number; ocrRunId?: string; aliasOfSection?: string };
  ambiguousTime?: boolean; // True if AM/PM was unconfirmed/ambiguous during OCR extraction
  resolvedFromAmbiguousTime?: boolean; // User explicitly confirmed an originally ambiguous OCR time
}

export type SectionCodeRelation =
  | { kind: 'exact-course-code-alias' }
  | { kind: 'derived-section'; sectionNumber: string }
  | { kind: 'independent-section' }
  | { kind: 'unrelated-course-code' };

export interface Section {
  id: string; // Unique section identifier, e.g. "BUS302-New02"
  name: string; // Course name/title, e.g. "Business Ethics"
  courseKey?: string; // Stable logical course identity when available
  courseCode?: string | null;
  sectionCode?: string | null;
  rawSectionCode?: string | null;
  canonicalSectionKey?: string | null;
  rawSectionCodeVariants?: string[];
  sectionCodeRaw?: string | null;
  normalizedSectionIdentity?: string | null;
  sectionKey?: string | null;
  sectionRelationship?: SectionCodeRelation['kind'];
  sectionCodeMissing?: boolean;
  needsReview?: boolean;
  reviewReasons?: string[];
  conflictingMeetings?: unknown[];
  incompleteMeetings?: Array<{
    raw: unknown;
    reasonCodes: string[];
    source?: { sourceChunkIndex?: number; sourceImageIndexes?: number[]; sourceImageIndex?: number; model?: string; sourceRecordIndex?: number; ocrRunId?: string };
  }>;
  creditHoursConflict?: number[] | null;
  rawOcrEvidence?: unknown[];
  derivedSectionAliases?: Array<{
    derivedSectionAlias: string;
    derivedFrom: string;
    reason: string;
  }>;
  codeInferred?: boolean;
  courseCodeInferenceSource?: 'explicit_field' | 'labelled_text' | 'embedded_title' | 'unknown';
  sourceImageIndexes?: number[];
  ocrRunId?: string;
  workflowGenerationId?: string;
  reviewAcknowledged?: boolean;
  tutorialCode?: string | null;
  partTime?: boolean | string | null;
  credits: number | null; // e.g. 3, or null if missing from extraction
  sessions: Session[];
  mergedFromIds?: string[];
  instructor?: string | null;
  otherInstructors?: string[]; // collapsed instructor variants
  colorIndex?: number; // custom user-selected color palette index
  sourceKind?: 'ocr' | 'manual' | 'recovered';
  originalOcrCourseCode?: string | null;
  originalOcrCourseName?: string | null;
  editedFields?: string[];
  /** Immutable source provenance retained separately from user-authored changes. */
  sourceEvidence?: { sourceImageIndexes?: number[]; ocrRunId?: string; raw?: unknown[] };
  /** Explicit user overrides are stored separately so OCR provenance remains auditable. */
  userOverrides?: Record<string, string | number | boolean | null>;
  reviewGenerationId?: string;
}

export interface LegacySection extends Omit<Section, 'sectionRelationship'> { sectionRelationship?: string; }

export interface CourseGroup {
  name: string;
  sections: Section[];
  colorIndex?: number;
}

export interface OptimizationResult {
  id: string;
  sections: Section[];
  days: DayOfWeek[];
  numDays: number;
  totalGap: number; // in minutes
  totalCredits: number;
  earliestStartMinutes: number;
  latestEndMinutes: number;
  isTie?: boolean;
  tieReason?: string;
  isFavorite?: boolean;
  /** False when one or more selected courses have missing/conflicting credit metadata. */
  creditsComplete?: boolean;
  scheduleSignature?: string;
  globalRank?: number;
  categoryRank?: number;
}

export interface SchedulePreferences {
  targetCredits: number | null;
  /** Requested campus-day result buckets. Defaults to all 1–7 days. */
  dayBuckets?: number[];
  targetCourseCount: number | null; // e.g. 4, 5, 6, or null (any)
  /** Legacy/display labels for mandatory courses. New state should use mandatoryCourseKeys. */
  mandatoryCourses: string[];
  /** Stable logical course identities (courseKey values) that MUST be included in every generated schedule. */
  mandatoryCourseKeys?: string[];
  useCreditRange?: boolean;
  minCredits?: number;
  maxCredits?: number;
  earliestStartTime?: string;
  latestEndTime?: string;
  freeDays?: DayOfWeek[];
  maxDays?: number | null;
  preferCompactDays?: boolean;
}

export interface AchievableCreditSummary {
  credits: number;
  count: number;
  countWithoutMandatory?: number;
  closest?: boolean;
}

export interface OptimizerOutput {
  allSectionsConsidered: Section[];
  byDayCount: {
    [key: number]: OptimizationResult[];
  };
  totalFoundByDay: {
    [key: number]: number;
  };
  totalCombinationsEvaluated: number;
  achievableCredits?: AchievableCreditSummary[];
  diagnostics?: string[];
  impossibleDiagnostic?: {
    reason: string;
    suggestion: string;
    actionType?: 'auto_adjust_credits' | 'clear_free_days' | 'clear_time_limits' | 'unmark_mandatory' | 'allow_credit_range' | 'allow_all_days' | 'relax_max_days';
    actionLabel?: string;
    suggestedTargetCredits?: number;
    achievableCreditSums?: number[];
    achievableCreditOptions?: AchievableCreditSummary[];
    countIfRelaxed?: number;
    secondaryDiagnostics?: Array<{
      reason: string;
      suggestion: string;
      actionType?: 'auto_adjust_credits' | 'clear_free_days' | 'clear_time_limits' | 'unmark_mandatory' | 'allow_credit_range' | 'allow_all_days' | 'relax_max_days';
      actionLabel?: string;
      countIfRelaxed?: number;
    }>;
  };
  secondaryDiagnostics?: Array<{
    reason: string;
    suggestion: string;
    actionType?: 'auto_adjust_credits' | 'clear_free_days' | 'clear_time_limits' | 'unmark_mandatory' | 'allow_credit_range' | 'allow_all_days' | 'relax_max_days';
    actionLabel?: string;
    countIfRelaxed?: number;
  }>;
  wasSampled?: boolean;
  wasCapped?: boolean;
  sampledCourseCountRange?: { min: number; max: number };
  searchCompleteness?: 'exhaustive' | 'sampled' | 'capped' | 'cancelled' | 'not_searched' | 'preflight_rejected';
  searchStats?: { candidateCourseSubsets: number; schedulesEvaluated: number; schedulesReturned: number; courseSubsetNodes?: number; sectionNodes?: number };
  preferencesUsed?: SchedulePreferences;
  generatedInputsSignature?: string;
  generatedAt?: number;
  /** Legacy persisted results without a trustworthy generation signature are unverifiable. */
  signatureStatus?: 'verified' | 'unknown';
  workflowGenerationId?: string;
  sectionsSnapshot?: Section[];
  sectionsSnapshotComplete?: boolean;
  preferencesSnapshotComplete?: boolean;
  resultContractVersion?: 'v2' | 'v3';
  buildVersion?: string;
  rankScopeVersion?: 'v2';
  selectedScheduleSignature?: string | null;
}

export type AppStep = 'home' | 'setup' | 'results';

export interface ParseWarning {
  field: string;
  message: string;
}
