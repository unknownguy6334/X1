import { Section, SectionCodeRelation } from '../types';

export interface CourseCodeStructure {
  dept: string;
  number: string;
  suffix: string | null;
  fullNormalized: string;
}

/**
 * Parses course code into structural components: department letters, course number digits, and optional suffix.
 * Examples:
 *   "BIM32108-BUS"  -> dept: "BIM", number: "32108", suffix: "BUS"
 *   "FIN 321"       -> dept: "FIN", number: "321", suffix: null
 *   "STA 311-BI"    -> dept: "STA", number: "311", suffix: "BI"
 *   "MATH 101A"     -> dept: "MATH", number: "101", suffix: "A"
 *   "FIN434"        -> dept: "FIN", number: "434", suffix: null
 */
export function parseCourseCodeStructure(rawCode: string | null | undefined): CourseCodeStructure | null {
  if (!rawCode || typeof rawCode !== 'string') return null;
  const trimmed = rawCode.trim().toUpperCase();
  if (!trimmed) return null;

  // Department (2-8 letters), Course number (1-6 digits), optional suffix (1-8 alphanumeric chars after separator or attached)
  const m = trimmed.match(/^([A-Z]{2,8})[\s_-]*(\d{1,6})(?:[\s_-]*([A-Z0-9]{1,8}))?$/);
  if (!m) return null;

  return {
    dept: m[1],
    number: m[2],
    suffix: m[3] ? m[3].replace(/^[\s_-]+|[\s_-]+$/g, '') : null,
    fullNormalized: `${m[1]}${m[2]}${m[3] ? m[3].replace(/^[\s_-]+|[\s_-]+$/g, '') : ''}`,
  };
}

/**
 * Classifies the structural relationship between a course code and a candidate section code.
 *
 * Distinguishes between:
 * 1. An exact course-code alias (candidate repeats course code, e.g. BIM32108-BUS) -> 'exact-course-code-alias'
 * 2. A derived section containing base course code + section discriminator (e.g. BIM3210801-BUS) -> 'derived-section'
 * 3. An unrelated course code (e.g. BIM32109-BUS or FIN321-BUS) -> 'unrelated-course-code'
 * 4. An independent section identifier (e.g. SEC-01, 01, A01, New01, LAB-A) -> 'independent-section'
 */
function isPlausibleSectionDiscriminator(value: string): boolean {
  const clean = value.trim().toUpperCase();
  return /^(?:\d{1,3}|[A-Z]\d{1,2}|(?:NEW|SEC|SECTION|LAB|TUT|TUTORIAL|DISC|DISCUSSION|REC|RECITATION)[-_]?[A-Z0-9]{0,3})$/.test(clean);
}

export function classifySectionCodeRelation(
  courseCode: string | null | undefined,
  candidateSectionCode: string | null | undefined
): SectionCodeRelation {
  if (!candidateSectionCode || typeof candidateSectionCode !== 'string') {
    return { kind: 'independent-section' };
  }
  const candTrimmed = candidateSectionCode.trim().toUpperCase();
  if (!candTrimmed) {
    return { kind: 'independent-section' };
  }

  if (!courseCode || typeof courseCode !== 'string') {
    return { kind: 'independent-section' };
  }
  const courseTrimmed = courseCode.trim().toUpperCase();
  if (!courseTrimmed) {
    return { kind: 'independent-section' };
  }

  const cleanCourse = courseTrimmed.replace(/[\s_-]+/g, '');
  const cleanCand = candTrimmed.replace(/[\s_-]+/g, '');

  // 1. Exact course-code alias (candidate simply repeats the course code)
  if (cleanCand === cleanCourse) {
    return { kind: 'exact-course-code-alias' };
  }

  const courseStructure = parseCourseCodeStructure(courseCode);
  if (!courseStructure) {
    // If courseCode itself is non-standard, check basic prefix relationship
    if (cleanCand.startsWith(cleanCourse) && cleanCand.length > cleanCourse.length) {
      const disc = cleanCand.slice(cleanCourse.length);
      if (isPlausibleSectionDiscriminator(disc)) {
        return { kind: 'derived-section', sectionNumber: disc };
      }
    }
    return { kind: 'independent-section' };
  }

  const { dept, number, suffix } = courseStructure;

  // Check if candidate starts with the same department letters
  if (!candTrimmed.startsWith(dept)) {
    // If candidate has a different department and looks like a full course code
    const candStruct = parseCourseCodeStructure(candidateSectionCode);
    if (candStruct && candStruct.dept !== dept && parseInt(candStruct.number, 10) >= 100) {
      return { kind: 'unrelated-course-code' };
    }
    return { kind: 'independent-section' };
  }

  // Candidate starts with dept
  const remainder = candTrimmed.slice(dept.length).replace(/^[\s_-]+/, '');

  // Check if candidate has a different course number entirely (e.g. BIM32109-BUS vs BIM32108-BUS)
  if (!remainder.startsWith(number)) {
    const candMatch = remainder.match(/^(\d{1,6})(?:[\s_-]*([A-Z0-9]+))?$/);
    if (candMatch) {
      const candNum = candMatch[1];
      // If course number and candidate number have same length and are different
      if (candNum.length === number.length && candNum !== number) {
        return { kind: 'unrelated-course-code' };
      }
    }
    return { kind: 'independent-section' };
  }

  // Candidate starts with dept + number
  const afterNumber = remainder.slice(number.length).replace(/^[\s_-]+/, '');

  // If course has suffix (e.g. "-BUS" or "BUS")
  if (suffix) {
    // Does afterNumber end with suffix?
    const suffixRegex = new RegExp(`[\\s_-]*${suffix}$`, 'i');
    if (suffixRegex.test(afterNumber)) {
      const discriminator = afterNumber.replace(suffixRegex, '').replace(/^[\s_-]+|[\s_-]+$/g, '');
      if (!discriminator) {
        return { kind: 'exact-course-code-alias' };
      }
      if (isPlausibleSectionDiscriminator(discriminator)) {
        return { kind: 'derived-section', sectionNumber: discriminator };
      }
    }
  } else {
    // Course had no suffix (e.g. FIN 434)
    // Candidate might be FIN434-New01, or FIN43401, or STA31101-BI
    if (afterNumber) {
      const discMatch = afterNumber.match(/^([A-Z0-9]{1,8})(?:[\s_-]*([A-Z0-9]{1,8}))?$/);
      if (discMatch) {
        const discriminator = discMatch[1];
        if (discriminator && isPlausibleSectionDiscriminator(discriminator)) {
          return { kind: 'derived-section', sectionNumber: discriminator };
        }
      }
    }
  }

  return { kind: 'independent-section' };
}

export function isPlaceholderSectionId(id: string | null | undefined): boolean {
  if (!id) return true;
  const clean = String(id).trim().toUpperCase();
  return clean.startsWith('OCR:') || clean.startsWith('CHUNK:') || clean.startsWith('TEMP:') || clean.startsWith('MISSING:');
}

export interface CompositeDerivedCodeResult {
  isDerived: boolean;
  baseCode: string;
  derivedCode: string;
  discriminator: string;
  basePrefix: string;
  trailingSuffix: string;
}


function validateMergedSection(section: Section): boolean {
  const sessions = section.sessions || [];
  const seen = new Set<string>();
  for (const session of sessions) {
    const key = `${session.day}|${session.start}|${session.end}|${session.type || 'Other'}|${session.customType || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const start = String(session.start || '');
    const end = String(session.end || '');
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return false;
  }
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i]; const b = sessions[j];
      if (a.day !== b.day || a.type !== b.type || (a.customType || '') !== (b.customType || '')) continue;
      const am = Number(a.start.slice(0, 2)) * 60 + Number(a.start.slice(3));
      const ae = Number(a.end.slice(0, 2)) * 60 + Number(a.end.slice(3));
      const bm = Number(b.start.slice(0, 2)) * 60 + Number(b.start.slice(3));
      const be = Number(b.end.slice(0, 2)) * 60 + Number(b.end.slice(3));
      if (Number.isFinite(am) && Number.isFinite(ae) && Number.isFinite(bm) && Number.isFinite(be) && am < be && bm < ae) return false;
    }
  }
  return true;
}
/**
 * Deterministically checks if two non-empty section codes satisfy a narrow composite/derived relationship:
 * BASE + SHORT_SECTION_DISCRIMINATOR + SAME_TRAILING_SUFFIX
 *
 * Requirements from Authoritative Specification (Section 4):
 * 1. Both identifiers are non-empty.
 * 2. One identifier is strictly longer than the other.
 * 3. After normalizing whitespace/dash variants ONLY for comparison, the longer identifier can be represented as:
 *    BASE + SHORT_SECTION_DISCRIMINATOR + SAME_TRAILING_SUFFIX
 *    where the discriminator is a short section-like numeric/alphanumeric token (normally 1–3 characters/digits).
 *
 * Example:
 * BASE: BIM32108-BUS
 * DERIVED: BIM3210801-BUS
 * -> Discriminator: "01", basePrefix: "BIM32108", trailingSuffix: "BUS"
 */
export function detectCompositeDerivedCode(
  codeA: string | null | undefined,
  codeB: string | null | undefined
): CompositeDerivedCodeResult | null {
  if (!codeA || !codeB || typeof codeA !== 'string' || typeof codeB !== 'string') {
    return null;
  }
  const trimmedA = codeA.trim();
  const trimmedB = codeB.trim();
  if (!trimmedA || !trimmedB) return null;
  if (isPlaceholderSectionId(trimmedA) || isPlaceholderSectionId(trimmedB)) return null;

  // Condition 3: One identifier is strictly longer than the other
  if (trimmedA.length === trimmedB.length) return null;

  const shorter = trimmedA.length < trimmedB.length ? trimmedA : trimmedB;
  const longer = trimmedA.length < trimmedB.length ? trimmedB : trimmedA;

  const normShorter = shorter.toUpperCase();
  const normLonger = longer.toUpperCase();

  // Condition 4: Normalize whitespace/dash variants ONLY for comparison
  const cleanShorter = normShorter.replace(/[\s_-]+/g, '');
  const cleanLonger = normLonger.replace(/[\s_-]+/g, '');

  if (cleanLonger.length <= cleanShorter.length) return null;

  // Search for valid split: BASE (>=2 chars) + TRAILING_SUFFIX (>=0 chars) = cleanShorter
  // such that cleanLonger === BASE + DISCRIMINATOR + TRAILING_SUFFIX
  // where DISCRIMINATOR is 1 to 3 characters/digits
  for (let baseLen = 2; baseLen <= cleanShorter.length; baseLen++) {
    const candidateBase = cleanShorter.slice(0, baseLen);
    const candidateSuffix = cleanShorter.slice(baseLen); // empty string if baseLen === cleanShorter.length

    if (!cleanLonger.startsWith(candidateBase)) continue;
    if (candidateSuffix && !cleanLonger.endsWith(candidateSuffix)) continue;

    const disc = cleanLonger.slice(candidateBase.length, cleanLonger.length - candidateSuffix.length);

    // Discriminator must be 1-3 alphanumeric characters/digits
    if (disc.length < 1 || disc.length > 3) continue;
    if (!isPlausibleSectionDiscriminator(disc)) continue;

    // Verify trailing suffix in original strings if non-empty
    if (candidateSuffix) {
      const suffixPattern = new RegExp(`[\\s_-]*${candidateSuffix}$`, 'i');
      if (!suffixPattern.test(normShorter) || !suffixPattern.test(normLonger)) {
        continue;
      }
    }

    return {
      isDerived: true,
      baseCode: shorter,
      derivedCode: longer,
      discriminator: disc,
      basePrefix: candidateBase,
      trailingSuffix: candidateSuffix,
    };
  }

  return null;
}

/**
 * Checks schedule compatibility for derived composite code consolidation.
 * Per Section 4 Condition 5 and Section 8:
 * - Exact duplicate meetings are the strongest signal.
 * - If schedules are independently different (e.g. MON 10:00 vs TUE 14:00), returns compatible: false.
 */
export function areSchedulesCompatibleForDerivedMerge(
  secA: Partial<Section>,
  secB: Partial<Section>
): { compatible: boolean; reason?: string } {
  const sessionsA = secA.sessions || [];
  const sessionsB = secB.sessions || [];

  if (sessionsA.length === 0 || sessionsB.length === 0) {
    return { compatible: false, reason: 'insufficient_schedule_evidence' };
  }

  const normKey = (s: any) =>
    `${String(s.day || '').trim().toUpperCase()}|${String(s.start || '').trim()}|${String(s.end || '').trim()}|${String(s.type || 'Other').trim().toLowerCase()}`;

  const setA = new Set(sessionsA.map(normKey));
  const setB = new Set(sessionsB.map(normKey));

  // Consolidation is lossless only when both records describe the exact same meeting set.
  // Partial/subset overlap can represent distinct selectable sections and must never be merged.
  if (setA.size === setB.size && [...setA].every((k) => setB.has(k))) {
    return { compatible: true, reason: 'exact_duplicate_meetings' };
  }

  return { compatible: false, reason: 'non_identical_schedules' };
}

/**
 * Consolidates sections belonging to the same course when a pair satisfies
 * the narrow composite/derived relationship and schedule evidence is compatible.
 *
 * Guarantees:
 * 1. The shorter/base identifier remains the canonical visible code (Section 3).
 * 2. The longer derived identifier is preserved as raw evidence / alias metadata (Section 11).
 * 3. Does not produce a second selectable option (Section 3).
 * 4. Preserves independent schedules and marks them for review instead of merging (Section 8).
 */
export function consolidateDerivedCompositeSections(
  sections: Section[],
  losslessMerger?: (target: Section, incoming: Section) => void
): Section[] {
  if (!sections || sections.length <= 1) return sections || [];

  const remaining = [...sections];

  for (let i = 0; i < remaining.length; i++) {
    const secA = remaining[i];
    if (!secA) continue;
    const codeA = secA.sectionCode || secA.rawSectionCode;

    for (let j = i + 1; j < remaining.length; j++) {
      const secB = remaining[j];
      if (!secB) continue;
      const codeB = secB.sectionCode || secB.rawSectionCode;

      const derivedCheck = detectCompositeDerivedCode(codeA, codeB);
      if (!derivedCheck) continue;

      // Check schedule compatibility
      const scheduleComp = areSchedulesCompatibleForDerivedMerge(secA, secB);
      if (!scheduleComp.compatible) {
        // Related codes but independent schedules (Section 8 / Test 4)
        secA.needsReview = true;
        secA.reviewReasons = Array.from(new Set([...(secA.reviewReasons || []), 'related_codes_independent_schedules']));
        secB.needsReview = true;
        secB.reviewReasons = Array.from(new Set([...(secB.reviewReasons || []), 'related_codes_independent_schedules']));
        continue;
      }

      // Merge only after an exact semantic schedule match. This prevents a derived code
      // from converting two distinct schedules into one hybrid selectable section.
      const strictScheduleCheck = areSchedulesCompatibleForDerivedMerge(secA, secB);
      if (!strictScheduleCheck.compatible) continue;

      const isAShorter = derivedCheck.baseCode === (secA.sectionCode || secA.rawSectionCode);
      const baseSec = isAShorter ? secA : secB;
      const derivedSec = isAShorter ? secB : secA;
      const derivedIndex = isAShorter ? j : i;

      const baseSnapshot = JSON.parse(JSON.stringify(baseSec)) as Section;
      // 1. Canonical visible code remains shorter/base identifier (Section 3)
      baseSec.sectionCode = derivedCheck.baseCode;
      baseSec.sectionCodeMissing = false;

      // 2. Preserve raw derived identifier in evidence / audit metadata (Section 11)
      const aliasRecord = {
        derivedSectionAlias: derivedCheck.derivedCode,
        derivedFrom: derivedCheck.baseCode,
        reason: 'composite_section_identifier',
      };
      baseSec.rawOcrEvidence = [...(baseSec.rawOcrEvidence || []), aliasRecord];
      if (!baseSec.derivedSectionAliases) {
        baseSec.derivedSectionAliases = [];
      }
      baseSec.derivedSectionAliases.push(aliasRecord);

      // 3. Losslessly merge evidence from derivedSec into baseSec
      if (losslessMerger) {
        losslessMerger(baseSec, derivedSec);
      } else {
        // Built-in fallback lossless merge
        if (!baseSec.instructor && derivedSec.instructor) baseSec.instructor = derivedSec.instructor;
        if (baseSec.credits == null && derivedSec.credits != null) baseSec.credits = derivedSec.credits;
        if (derivedSec.sessions?.length) {
          const normKey = (s: any) => `${s.day}|${s.start}|${s.end}|${(s.type || 'Other').toLowerCase()}`;
          const existing = new Set((baseSec.sessions || []).map(normKey));
          for (const s of derivedSec.sessions) {
            if (!existing.has(normKey(s))) {
              baseSec.sessions.push(s);
              existing.add(normKey(s));
            }
          }
        }
        if (derivedSec.id) {
          baseSec.mergedFromIds = Array.from(new Set([...(baseSec.mergedFromIds || []), derivedSec.id]));
        }
      }

      // Re-assert canonical code on baseSec
      baseSec.sectionCode = derivedCheck.baseCode;
      baseSec.sectionCodeMissing = false;
      if (!validateMergedSection(baseSec)) {
        // Never publish a synthetic/hybrid section. Reconciliation can keep the two
        // source options separate when the post-merge invariant is not satisfied.
        const restoreIndex = remaining.indexOf(baseSec);
        if (restoreIndex >= 0) Object.assign(baseSec, baseSnapshot);
        if (restoreIndex >= 0) remaining[restoreIndex] = baseSec;
        continue;
      }

      // Attach alias provenance to retained meetings so later layers can trace why a
      // meeting survived a derived-code consolidation.
      for (const meeting of baseSec.sessions || []) {
        const currentIndexes = meeting.sourceEvidence?.sourceImageIndexes || baseSec.sourceImageIndexes || [];
        meeting.sourceEvidence = { ...(meeting.sourceEvidence || {}), sourceImageIndexes: currentIndexes, ocrRunId: meeting.sourceEvidence?.ocrRunId || baseSec.ocrRunId, aliasOfSection: derivedCheck.derivedCode };
      }

      // 4. Remove derivedSec from remaining so it does NOT create another selectable option
      remaining.splice(derivedIndex, 1);

      if (!isAShorter) {
        i--;
        break;
      } else {
        j--;
      }
    }
  }

  return remaining;
}

/**
 * Canonicalizes section code string for deterministic identity comparison (Specification Section 3).
 * Normalizes only harmless formatting differences (whitespace, dashes, casing, separators)
 * while preserving meaningful identifier distinctions (e.g. A-01 vs A-02, FIN434-New01 vs FIN434-New03).
 */
export function canonicalizeSectionIdentity(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';

  // 10. Normalize Unicode whitespace characters to ordinary spaces before normalization
  let s = raw.replace(/[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/g, ' ');

  // 7. Normalize equivalent formatting around dashes: replace Unicode dashes with standard ASCII '-'
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');

  // 1 & 2. Trim leading and trailing whitespace
  s = s.trim();
  if (!s || isPlaceholderSectionId(s)) return '';

  // 6. Normalize case for comparison (uppercase)
  s = s.toUpperCase();

  // 4, 5, 7, 8, 9. Remove whitespace immediately before and after separators: '-', '_', '/', ':'
  s = s.replace(/\s*([-_/:])\s*/g, '$1');

  // 3. Collapse repeated internal whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim();
}

/**
 * Normalizes harmless whitespace and separator formatting for user-facing display
 * while preserving character casing (e.g. "FIN434 - New01" -> "FIN434-New01").
 */
export function canonicalizeDisplaySectionCode(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw.replace(/[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/g, ' ');
  s = s.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  s = s.trim();
  if (!s || isPlaceholderSectionId(s)) return null;

  // Remove whitespace around separators
  s = s.replace(/\s*([-_/:])\s*/g, '$1');
  // Collapse repeated internal whitespace
  s = s.replace(/\s+/g, ' ');

  return s.trim() || null;
}

/**
 * Resolves the comparison canonical key for a section record.
 */
export function getCanonicalSectionKey(
  section: Partial<Section> | {
    rawSectionCode?: string | null;
    sectionCode?: string | null;
    sectionCodeMissing?: boolean;
    sectionKey?: string | null;
    canonicalSectionKey?: string | null;
  }
): string | null {
  if (section.sectionCodeMissing) return null;
  if (section.canonicalSectionKey) return section.canonicalSectionKey;
  if (section.sectionKey?.startsWith('MISSING:')) return null;

  const raw = section.rawSectionCode ?? section.sectionCode;
  if (!raw || isPlaceholderSectionId(raw)) return null;

  const key = canonicalizeSectionIdentity(raw);
  return (!key || isPlaceholderSectionId(key)) ? null : key;
}

/**
 * Merges duplicate section records belonging to the same course when their
 * canonical section keys are identical. Preserves all raw observations in
 * rawSectionCodeVariants, losslessly deduplicates meetings, and keeps
 * clean canonical display formatting.
 */
export function mergeDuplicateCanonicalSections(
  sections: Section[],
  losslessMerger: (target: Section, incoming: Section) => void
): Section[] {
  if (!Array.isArray(sections) || sections.length <= 1) return sections || [];

  const result: Section[] = [];
  const canonicalMap = new Map<string, Section>();

  for (const section of sections) {
    const key = getCanonicalSectionKey(section);
    if (!key || section.sectionCodeMissing) {
      result.push(section);
      continue;
    }

    const existing = canonicalMap.get(key);
    if (!existing) {
      canonicalMap.set(key, section);
      result.push(section);
    } else {
      losslessMerger(existing, section);
    }
  }

  return result;
}

/**
 * Resolves the logical section identity within a course.
 * Uses deterministic canonical section key normalization.
 * For placeholder IDs, or missing codes, returns null.
 */
export function getResolvedSectionIdentity(section: Partial<Section>): string | null {
  return getCanonicalSectionKey(section);
}
