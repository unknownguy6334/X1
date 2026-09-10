import type { jsPDF } from 'jspdf';
import { OptimizationResult, Section, Session, DayOfWeek } from '../types';
import { timeToMinutes, formatTime12 } from './optimizer';
import { getBrowserCapabilities } from './browserCapabilities';
import { DAY_ORDER, DAY_FULL_NAMES, assertExportableSchedule } from './exportCalendar';
import { formatCourseDisplay } from './courseUtils';
export { generateICS, downloadICS, downloadSingleScheduleIcs } from './exportCalendar';

// ----------------------------------------------------------------------
// 1. PLAIN-TEXT FORMATTERS
// ----------------------------------------------------------------------

interface DaySessionItem {
  day: DayOfWeek;
  dayName: string;
  start12: string;
  end12: string;
  startMin: number;
  courseName: string;
  courseId: string;
  credits: number | null;
  instructor?: string | null;
  type?: string;
}

export interface UniqueCourseItem {
  name: string;
  code: string;
  credits: number | null;
}

export function getUniqueScheduleCourses(schedule: OptimizationResult): UniqueCourseItem[] {
  const seen = new Set<string>();
  const list: UniqueCourseItem[] = [];

  for (const sec of schedule.sections) {
    const cleanName = (sec.name || '').trim();
    const cleanCode = (sec.courseCode || '').trim();
    const sectionCode = (sec.sectionCode || '').trim();
    const key = `${(sec.courseKey || cleanCode || cleanName).toLowerCase()}___${sectionCode.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      list.push({
        name: cleanName,
        code: cleanCode,
        credits: sec.credits ?? null,
      });
    }
  }

  return list;
}

function formatWaitingTime(totalGapMinutes: number): string {
  if (!Number.isFinite(totalGapMinutes) || totalGapMinutes <= 0) return '0m';
  const hours = Math.floor(totalGapMinutes / 60);
  const mins = totalGapMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function getScheduleDaySessions(schedule: OptimizationResult): Record<DayOfWeek, DaySessionItem[]> {
  const grouped: Record<DayOfWeek, DaySessionItem[]> = {
    SUN: [],
    MON: [],
    TUE: [],
    WED: [],
    THU: [],
    FRI: [],
    SAT: [],
  };

  for (const section of schedule.sections) {
    const credits = section.credits ?? null;
    for (const session of section.sessions) {
      if (grouped[session.day]) {
        grouped[session.day].push({
          day: session.day,
          dayName: DAY_FULL_NAMES[session.day] || session.day,
          start12: formatTime12(session.start),
          end12: formatTime12(session.end),
          startMin: timeToMinutes(session.start),
          courseName: formatCourseDisplay(section.courseCode, section.name),
          courseId: (section.sectionCode || '').trim(),
          credits,
          instructor: section.instructor || null,
          type: session.type,
        });
      }
    }
  }

  for (const day of DAY_ORDER) {
    grouped[day].sort((a, b) => a.startMin - b.startMin);
  }

  return grouped;
}

/**
 * Format a single schedule in clean plain text with "COURSES IN THIS SCHEDULE" at the top.
 */
export function formatScheduleAsText(schedule: OptimizationResult, rank: number = 1): string {
  const courses = getUniqueScheduleCourses(schedule);
  const daySessions = getScheduleDaySessions(schedule);
  const lines: string[] = [`Schedule ${rank}`, ''];

  // Top Section: COURSES IN THIS SCHEDULE
  lines.push('COURSES IN THIS SCHEDULE');
  for (const c of courses) {
    lines.push(`${c.name}${c.code ? ` | ${c.code}` : ''}`);
  }
  lines.push('');

  // Day-by-Day Schedule (Sunday through Saturday)
  let hasAnySession = false;
  for (const day of DAY_ORDER) {
    const sessions = daySessions[day];
    if (sessions.length > 0) {
      hasAnySession = true;
      lines.push(DAY_FULL_NAMES[day].toUpperCase());
      for (const s of sessions) {
        lines.push(`${s.start12} to ${s.end12}`);
        lines.push(`${s.courseName}${s.courseId ? ` (${s.courseId})` : ''}`);
        lines.push(`${s.credits == null ? 'Unknown' : s.credits} Credits`);
        if (s.instructor && s.instructor.trim() && s.instructor !== 'TBA') {
          lines.push(`Instructor: ${s.instructor.trim()}`);
        }
        lines.push('');
      }
    }
  }

  if (!hasAnySession) {
    lines.push('No scheduled course meetings.');
    lines.push('');
  }

  lines.push(`Campus Days: ${schedule.numDays} Days`);
  lines.push(`Total Credits: ${schedule.totalCredits} credits`);
  lines.push(`Courses: ${courses.length}`);
  lines.push(`Waiting Time: ${formatWaitingTime(schedule.totalGap)}`);

  return lines.join('\n').trim();
}

/**
 * Extract unique course registration codes / CRNs from a schedule.
 */
export function getScheduleRegistrationCodes(schedule: OptimizationResult): { code: string; courseName: string; credits: number | null }[] {
  const list: { code: string; courseName: string; credits: number | null }[] = [];
  const seen = new Set<string>();
  for (const sec of schedule.sections) {
    const rawCode = String(sec.sectionCode || '').trim();
    const dedupeKey = `${(sec.courseKey || sec.courseCode || sec.name || '').toLocaleLowerCase()}::${rawCode.toLocaleLowerCase()}`;
    if (rawCode && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      list.push({ code: rawCode, courseName: formatCourseDisplay(sec.courseCode, sec.name), credits: sec.credits ?? null });
    }
  }
  return list;
}

/**
 * Format registration codes (CRNs) in a clean comma-separated list ready for registrar quick-add.
 */
export function formatScheduleCodesForRegistration(schedule: OptimizationResult): string {
  const codes = getScheduleRegistrationCodes(schedule);
  return codes.map((c) => c.code).join(', ');
}

/**
 * Format registration codes with full course names and credits.
 */
export function formatScheduleCodesWithDetails(schedule: OptimizationResult, rank: number = 1): string {
  const codes = getScheduleRegistrationCodes(schedule);
  const lines: string[] = [
    `SCHEDULE ${rank} REGISTRATION CODES (CRNs):`,
    `Quick Paste: ${codes.map((c) => c.code).join(', ')}`,
    '',
    'COURSES BREAKDOWN:',
  ];
  for (const c of codes) {
    lines.push(`• ${c.courseName}: ${c.code} (${c.credits} credits)`);
  }
  return lines.join('\n');
}

/**
 * Copies text safely to clipboard with fallback.
 */
export interface ClipboardCopyResult {
  success: boolean;
  method: 'clipboard-api' | 'execCommand' | 'manual' | 'none';
  reason?: 'insecure-context' | 'permission-denied' | 'api-unavailable' | 'fallback-failed' | 'manual-required' | 'unknown';
}

export async function copyToClipboardDetailed(text: string): Promise<ClipboardCopyResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { success: false, method: 'none', reason: 'api-unavailable' };
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    if (window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return { success: true, method: 'clipboard-api' };
      } catch (err) {
        console.warn('Navigator clipboard failed, attempting fallback', err);
        // Continue to the legacy fallback; browsers can deny clipboard permission
        // even in a secure context.
      }
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = typeof document.execCommand === 'function' && document.execCommand('copy');
    textArea.remove();
    return successful
      ? { success: true, method: 'execCommand' }
      : { success: false, method: 'manual', reason: 'manual-required' };
  } catch (err) {
    console.error('Clipboard fallback failed', err);
    return {
      success: false,
      method: 'none',
      reason: typeof navigator !== 'undefined' && navigator.clipboard && !window.isSecureContext ? 'insecure-context' : 'fallback-failed',
    };
  }
}

/** Boolean compatibility wrapper for existing integrations. */
export async function copyToClipboard(text: string): Promise<boolean> {
  return (await copyToClipboardDetailed(text)).success;
}


function getPdfSessionRowHeight(doc: jsPDF, fullCourseLabel: string, middleWidth: number): number {
  const wrappedLines = doc.splitTextToSize(fullCourseLabel, middleWidth);
  return Math.max(7.5, wrappedLines.length * 3.8 + 3.8);
}

// ----------------------------------------------------------------------
// 2. PDF GENERATION (jsPDF) - Clean, Uncut Full Course Names, Highlighted Courses Box
// ----------------------------------------------------------------------

type PdfFontPayload = { regular: string; bold: string };
let pdfFontPayloadPromise: Promise<PdfFontPayload | null> | null = null;

export interface ExportTaskOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled.');
    this.name = 'AbortError';
  }
}

function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportCancelledError();
}

async function yieldToBrowser(signal?: AbortSignal): Promise<void> {
  throwIfExportAborted(signal);
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
  throwIfExportAborted(signal);
}

function reportExportProgress(options: ExportTaskOptions | undefined, completed: number, total: number): void {
  options?.onProgress?.(Math.max(0, Math.min(1, total > 0 ? completed / total : 1)));
}

const EXPORT_FONT_STACK = '"Noto Kufi Arabic", "Noto Naskh Arabic", "Segoe UI", Tahoma, Arial, sans-serif';

async function getPdfFontPayload(): Promise<PdfFontPayload | null> {
  if (!pdfFontPayloadPromise) {
    pdfFontPayloadPromise = (async () => {
      try {
        const load = async (url: string) => {
          const response = await fetch(url);
          if (!response.ok) return null;
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          return binary;
        };
        const [regular, bold] = await Promise.all([
          load(new URL('fonts/NotoKufiArabic-Regular.ttf', document.baseURI).toString()),
          load(new URL('fonts/NotoKufiArabic-Bold.ttf', document.baseURI).toString()),
        ]);
        return regular && bold ? { regular, bold } : null;
      } catch (error) {
        console.warn('Arabic PDF font loading failed; standard fonts will be used.', error);
        return null;
      }
    })();
  }
  return pdfFontPayloadPromise;
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

async function deliverBlob(blob: Blob, filename: string, shareTitle: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  let downloaded = false;
  let shared = false;
  let opened = false;
  try {
    const capabilities = getBrowserCapabilities();

    if (capabilities.download) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      downloaded = true;
    }

    if (capabilities.share) {
      try {
        const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        await navigator.share({ title: shareTitle, files: [file] });
        shared = true;
      } catch {
        // User cancellation or browser share-policy rejection falls through to open/manual recovery.
      }
    }

    if (!downloaded && !shared) {
      opened = Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
    }

    if (!downloaded && !shared && !opened) {
      throw new Error('This browser could not download, share, or open the exported file.');
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}


function pdfText(doc: jsPDF, text: string): string {
  const value = String(text ?? '');
  if (containsArabic(value) && typeof (doc as any).processArabic === 'function') {
    return (doc as any).processArabic(value);
  }
  return value;
}

function setPdfFont(doc: jsPDF, weight: 'normal' | 'bold'): void {
  try {
    doc.setFont('NotoKufiArabic', weight);
  } catch {
    doc.setFont('helvetica', weight);
  }
}

function addPdfPageHeader(doc: jsPDF, rank: number, title: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  doc.setFillColor(23, 24, 28);
  doc.roundedRect(margin, 14, pageWidth - margin * 2, 20, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  setPdfFont(doc, 'bold');
  doc.setFontSize(13);
  doc.text(pdfText(doc, 'Gadwal'), margin + 7, 27);
  doc.setFillColor(42, 74, 103);
  doc.roundedRect(pageWidth - margin - 55, 18.5, 48, 11, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(`Schedule Option ${rank}`, pageWidth - margin - 31, 25.2, { align: 'center' });
  doc.setTextColor(23, 24, 28);
  if (title) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(pdfText(doc, title), margin, 39);
  }
  return title ? 44 : 40;
}

/**
 * Generate and download a single schedule as a paginated PDF. All variable-height
 * sections are preflighted against the same wrapped-line measurements used for drawing.
 */
export async function downloadSchedulePDF(
  schedule: OptimizationResult,
  rank: number = 1,
  options?: ExportTaskOptions
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  assertExportableSchedule(schedule);
  throwIfExportAborted(options?.signal);
  if (typeof document === 'undefined') throw new Error('PDF export requires a browser document.');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const fontPayload = await getPdfFontPayload();
  throwIfExportAborted(options?.signal);
  if (fontPayload) {
    try {
      doc.addFileToVFS('NotoKufiArabic-Regular.ttf', fontPayload.regular);
      doc.addFont('NotoKufiArabic-Regular.ttf', 'NotoKufiArabic', 'normal', 'Identity-H');
      doc.addFileToVFS('NotoKufiArabic-Bold.ttf', fontPayload.bold);
      doc.addFont('NotoKufiArabic-Bold.ttf', 'NotoKufiArabic', 'bold', 'Identity-H');
    } catch (error) {
      console.warn('Arabic PDF font registration failed; using standard fonts.', error);
    }
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const pageBottom = pageHeight - 14;
  const middleWidth = contentWidth - 64 - 32;
  const lineHeight = 3.8;
  const rowGap = 2;
  const dayHeaderHeight = 6.5;

  const courses = getUniqueScheduleCourses(schedule);
  const daySessions = getScheduleDaySessions(schedule);
  const activeDays = DAY_ORDER.filter((d) => daySessions[d].length > 0);
  // Preflight using exactly the same fonts/sizes used by the eventual drawing code.
  // This prevents page-break calculations from drifting because jsPDF changed font metrics.
  setPdfFont(doc, 'bold');
  doc.setFontSize(8.2);
  const courseEntries = courses.map((course) => doc.splitTextToSize(
    pdfText(doc, `${course.name}${course.code ? ` | ${course.code}` : ''}`),
    contentWidth - 14
  ) as string[]);

  setPdfFont(doc, 'normal');
  doc.setFontSize(7.8);
  const allRows: Array<{ day: DayOfWeek; height: number }> = [];
  for (const day of activeDays) {
    for (const session of daySessions[day]) {
      const label = `${session.courseName}${session.courseId ? ` (${session.courseId})` : ''}`;
      allRows.push({ day, height: getPdfSessionRowHeight(doc, label, middleWidth) });
    }
  }

  const totalUnits = Math.max(1, courses.length + allRows.length + activeDays.length);
  let completedUnits = 0;
  const progress = () => reportExportProgress(options, completedUnits, totalUnits);
  progress();

  let currentY = addPdfPageHeader(doc, rank, 'Optimized schedule');

  // Summary strip.
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 219, 197);
  doc.roundedRect(margin, currentY, contentWidth, 22, 1.5, 1.5, 'FD');
  const stats = [
    ['Campus Days', `${schedule.numDays} Days`],
    ['Total Credits', `${schedule.totalCredits} credits`],
    ['Courses', `${courses.length} Courses`],
    ['Waiting Time', formatWaitingTime(schedule.totalGap)],
  ];
  const statWidth = contentWidth / stats.length;
  stats.forEach(([label, value], index) => {
    const x = margin + statWidth * index + statWidth / 2;
    doc.setTextColor(112, 107, 89);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(label.toUpperCase(), x, currentY + 8, { align: 'center' });
    doc.setTextColor(23, 24, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(String(value), x, currentY + 16, { align: 'center' });
  });
  currentY += 28;

  const addPage = async (headerTitle = '') => {
    throwIfExportAborted(options?.signal);
    doc.addPage();
    currentY = addPdfPageHeader(doc, rank, headerTitle);
    await yieldToBrowser(options?.signal);
  };

  // Course list: chunk individual wrapped lines across pages so no calculated box can exceed A4.
  let remainingCourseLines = courseEntries.flat();
  let courseHeadingPending = true;
  while (remainingCourseLines.length > 0 || courseHeadingPending) {
    throwIfExportAborted(options?.signal);
    const headingHeight = courseHeadingPending ? 8 : 0;
    const linePadding = 12;
    const available = Math.max(0, pageBottom - currentY - headingHeight - 4);
    const maxLines = Math.floor((available - linePadding) / lineHeight);
    if (maxLines < 1) {
      await addPage('Courses in this schedule');
      courseHeadingPending = false;
      continue;
    }
    const take = Math.min(maxLines, remainingCourseLines.length);
    const chunk = remainingCourseLines.splice(0, take);
    if (courseHeadingPending) {
      setPdfFont(doc, 'bold');
      doc.setTextColor(23, 24, 28);
      doc.setFontSize(8);
      doc.text(pdfText(doc, 'COURSES IN THIS SCHEDULE'), margin, currentY + 2);
      currentY += 7;
      courseHeadingPending = false;
    }
    const boxHeight = linePadding + chunk.length * lineHeight;
    if (currentY + boxHeight > pageBottom) {
      remainingCourseLines = [...chunk, ...remainingCourseLines];
      await addPage('Courses in this schedule');
      continue;
    }
    doc.setFillColor(238, 233, 217);
    doc.setDrawColor(199, 191, 169);
    doc.roundedRect(margin, currentY, contentWidth, boxHeight, 1.5, 1.5, 'FD');
    setPdfFont(doc, 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(23, 24, 28);
    let lineY = currentY + 7;
    for (const line of chunk) {
      doc.text(pdfText(doc, line), margin + 5, lineY);
      lineY += lineHeight;
      completedUnits += 1;
      progress();
    }
    currentY += boxHeight + 7;
    if (remainingCourseLines.length > 0) await yieldToBrowser(options?.signal);
  }

  // Day-by-day sessions. Preflight uses the exact row-height model used by rendering.
  let rowIndex = 0;
  for (const day of activeDays) {
    throwIfExportAborted(options?.signal);
    const sessions = daySessions[day];
    const rowHeights = sessions.map((session) => {
      const label = `${session.courseName}${session.courseId ? ` (${session.courseId})` : ''}`;
      return getPdfSessionRowHeight(doc, label, middleWidth);
    });
    const fullDayHeight = dayHeaderHeight + 2 + rowHeights.reduce((sum, h) => sum + h + rowGap, 0) + 2;
    if (currentY + fullDayHeight > pageBottom) await addPage(DAY_FULL_NAMES[day]);

    let dayHeaderDrawn = false;
    const drawDayHeader = () => {
      doc.setFillColor(238, 233, 217);
      doc.setDrawColor(199, 191, 169);
      doc.roundedRect(margin, currentY, contentWidth, dayHeaderHeight, 1, 1, 'FD');
      doc.setTextColor(23, 24, 28);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(DAY_FULL_NAMES[day].toUpperCase(), margin + 5, currentY + 4.5);
      currentY += dayHeaderHeight + 2;
      dayHeaderDrawn = true;
    };

    for (let i = 0; i < sessions.length; i++) {
      throwIfExportAborted(options?.signal);
      const session = sessions[i];
      const rowHeight = rowHeights[i];
      if (!dayHeaderDrawn) drawDayHeader();
      if (currentY + rowHeight > pageBottom) {
        await addPage(DAY_FULL_NAMES[day]);
        dayHeaderDrawn = false;
        drawDayHeader();
      }

      const fullCourseLabel = `${session.courseName}${session.courseId ? ` (${session.courseId})` : ''}`;
      const wrappedLines = doc.splitTextToSize(pdfText(doc, fullCourseLabel), middleWidth) as string[];
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(226, 219, 197);
      doc.roundedRect(margin, currentY, contentWidth, rowHeight, 1, 1, 'FD');

      doc.setTextColor(42, 74, 103);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(timeText(session.start12, session.end12), margin + 5, currentY + 5.1);

      setPdfFont(doc, 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(23, 24, 28);
      doc.text(wrappedLines.map((line) => pdfText(doc, line)), margin + 58, currentY + 5.1, { maxWidth: middleWidth });

      setPdfFont(doc, 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(86, 83, 74);
      doc.text(`${session.credits == null ? 'Unknown' : session.credits} Credits`, pageWidth - margin - 5, currentY + 5.1, { align: 'right' });

      currentY += rowHeight + rowGap;
      rowIndex += 1;
      completedUnits += 1;
      progress();
      if (rowIndex % 8 === 0) await yieldToBrowser(options?.signal);
    }
    currentY += 2;
    completedUnits += 1;
    progress();
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    throwIfExportAborted(options?.signal);
    doc.setPage(page);
    doc.setTextColor(112, 107, 89);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(`Gadwal • Option ${rank} • Page ${page} of ${pageCount}`, margin, pageHeight - 7);
  }

  throwIfExportAborted(options?.signal);
  reportExportProgress(options, totalUnits, totalUnits);
  const blob = doc.output('blob');
  await deliverBlob(blob, `Gadwal-Schedule-${rank}.pdf`, `Gadwal Schedule Option ${rank}`);
}

function timeText(start: string, end: string): string {
  return `${start} to ${end}`;
}


// ----------------------------------------------------------------------
// 3. IMAGE GENERATION (High-Res Canvas -> PNG) - Clean, Highlighted Courses Box, No Truncation
// ----------------------------------------------------------------------

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  const splitLongWord = (word: string) => {
    let chunk = '';
    for (const char of word) {
      const test = chunk + char;
      if (ctx.measureText(test).width > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = test;
      }
    }
    currentLine = chunk;
  };

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
      continue;
    }
    if (currentLine) {
      lines.push(currentLine);
      currentLine = '';
    }
    if (ctx.measureText(word).width <= maxWidth) currentLine = word;
    else splitLongWord(word);
  }
  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [''];
}

/**
 * Cross-browser rounded rectangle helper for HTML5 Canvas.
 * Supports older Safari and embedded browsers where ctx.roundRect is not implemented.
 */
function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(x, y, w, h, r);
  } else {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

/**
 * Renders a single schedule onto an HTML5 Canvas formatted simply, beautifully,
 * with COURSES IN THIS SCHEDULE at the top and NEVER truncating course names.
 */
export async function renderScheduleToCanvas(schedule: OptimizationResult, rank: number = 1, options?: ExportTaskOptions): Promise<HTMLCanvasElement> {
  assertExportableSchedule(schedule);
  throwIfExportAborted(options?.signal);
  // Ensure custom web fonts are fully loaded before rendering to canvas
  if (typeof document !== 'undefined' && 'fonts' in document) {
    try {
      await (document as any).fonts.ready;
      if (typeof (document as any).fonts.load === 'function') {
        await (document as any).fonts.load(`12px ${EXPORT_FONT_STACK}`);
      }
    } catch {
      // Graceful fallback to the explicit local/system export font stack.
    }
  }
  throwIfExportAborted(options?.signal);

  const canvas = document.createElement('canvas');
  const scale = 2; // Sharp retina display
  const width = 700;

  const courses = getUniqueScheduleCourses(schedule);
  const daySessions = getScheduleDaySessions(schedule);
  const activeDays = DAY_ORDER.filter((d) => daySessions[d].length > 0);
  const totalCanvasUnits = Math.max(1, courses.length + activeDays.reduce((sum, d) => sum + daySessions[d].length, 0));
  let completedCanvasUnits = 0;
  const reportCanvasProgress = () => reportExportProgress(options, completedCanvasUnits, totalCanvasUnits);
  reportCanvasProgress();

  // Temporary canvas context for measuring wrapped text heights accurately
  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d');
  if (mCtx) {
    mCtx.font = 'bold 12px "Noto Kufi Arabic", "Noto Kufi Arabic", "Plus Jakarta Sans", system-ui, sans-serif';
  }

  // Calculate Courses Box Height
  const courseBoxPadding = 12;
  const courseLineHeight = 22;
  const courseMaxWidth = width - 72;
  const courseEntries = courses.map((c) => {
    const entry = `${c.name}${c.code ? ` | ${c.code}` : ''}`;
    return mCtx ? wrapCanvasText(mCtx, entry, courseMaxWidth) : [entry];
  });
  const courseBoxHeight =
    courseBoxPadding * 2 +
    Math.max(1, courseEntries.reduce((sum, lines) => sum + lines.length, 0)) * courseLineHeight;

  // Calculate dynamic day sessions height
  let daysHeight = 0;
  for (const day of activeDays) {
    daysHeight += 26; // Day header
    const sessions = daySessions[day];
    for (const s of sessions) {
      const fullLabel = `${s.courseName}${s.courseId ? ` (${s.courseId})` : ''}`;
      const middleWidth = width - 48 - 180 - 100;
      const wrapped = mCtx ? wrapCanvasText(mCtx, fullLabel, middleWidth) : [fullLabel];
      const rowHeight = Math.max(34, wrapped.length * 16 + 18);
      daysHeight += rowHeight + 4;
    }
    daysHeight += 8; // day gap
  }

  let totalContentHeight = 24 + 54 + 14 + 42 + 16 + 18 + courseBoxHeight + 16 + daysHeight + 32;
  const pixelWidth = width * scale;
  const pixelHeight = Math.ceil(totalContentHeight * scale);
  const MAX_CANVAS_DIMENSION = 12000;
  const MAX_CANVAS_PIXELS = 35_000_000;
  if (pixelWidth > MAX_CANVAS_DIMENSION || pixelHeight > MAX_CANVAS_DIMENSION || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS) {
    throw new Error(
      'This schedule is too large for a single PNG export on this device. Use PDF export or split the schedule into smaller exports.'
    );
  }

  canvas.width = pixelWidth;
  canvas.height = pixelHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize canvas context');

  ctx.scale(scale, scale);

  // 1. Clean Warm Canvas Background
  ctx.fillStyle = '#F8F9F8'; // Surface #F8F9F8
  ctx.fillRect(0, 0, width, totalContentHeight);

  // Outer Border
  ctx.strokeStyle = '#C7CCCE';
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, width - 24, totalContentHeight - 24);

  let y = 24;

  // 2. Header Banner (Dark Ink)
  ctx.fillStyle = '#202426'; // Text #202426
  ctx.beginPath();
  drawRoundRect(ctx, 24, y, width - 48, 54, 4);
  ctx.fill();

  // Logo text
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 20px ${EXPORT_FONT_STACK}`;
  ctx.fillText('Gadwal', 40, y + 34);

  // Option Badge
  ctx.fillStyle = '#415A63'; // Brand primary
  ctx.beginPath();
  drawRoundRect(ctx, width - 40 - 150, y + 12, 150, 30, 4);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 12px ${EXPORT_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.fillText(`Schedule Option ${rank}`, width - 40 - 75, y + 31);
  ctx.textAlign = 'left';

  y += 68;

  // 3. Stats Strip
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#C7CCCE';
  ctx.lineWidth = 1;
  ctx.beginPath();
  drawRoundRect(ctx, 24, y, width - 48, 42, 3);
  ctx.fill();
  ctx.stroke();

  const stats = [
    { label: 'Campus Days', val: `${schedule.numDays} Days` },
    { label: 'Total Credits', val: `${schedule.totalCredits} credits` },
    { label: 'Courses', val: `${courses.length} Courses` },
    { label: 'Waiting Time', val: formatWaitingTime(schedule.totalGap) },
  ];

  const colW = (width - 48) / 4;
  stats.forEach((s, idx) => {
    const xPos = 24 + idx * colW + colW / 2;
    ctx.fillStyle = '#687074';
    ctx.font = '9.5px "Noto Kufi Arabic", "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.label.toUpperCase(), xPos, y + 16);

    ctx.fillStyle = '#202426';
    ctx.font = 'bold 12px "JetBrains Mono", monospace, sans-serif';
    ctx.fillText(s.val, xPos, y + 32);
  });
  ctx.textAlign = 'left';

  y += 56;

  // 4. COURSES IN THIS SCHEDULE (Highlighted Box at the Top)
  ctx.fillStyle = '#202426';
  ctx.font = `bold 11px ${EXPORT_FONT_STACK}`;
  ctx.fillText('COURSES IN THIS SCHEDULE', 24, y);

  y += 8;

  // Highlighted Box Container
  ctx.fillStyle = '#EDEEEE'; // Highlighted Mist
  ctx.strokeStyle = '#C7CCCE';
  ctx.lineWidth = 1;
  ctx.beginPath();
  drawRoundRect(ctx, 24, y, width - 48, courseBoxHeight, 3);
  ctx.fill();
  ctx.stroke();

  let cTextY = y + courseBoxPadding + 14;
  ctx.fillStyle = '#202426';
  ctx.font = `bold 12px ${EXPORT_FONT_STACK}`;

  for (const lines of courseEntries) {
    throwIfExportAborted(options?.signal);
    for (const line of lines) {
      ctx.fillText(line, 38, cTextY);
      cTextY += courseLineHeight;
    }
    completedCanvasUnits += 1;
    reportCanvasProgress();
    if (completedCanvasUnits % 12 === 0) await yieldToBrowser(options?.signal);
  }

  y += courseBoxHeight + 16;

  // 5. Day-by-Day Course Sessions (Sunday through Saturday)
  for (const day of activeDays) {
    const sessions = daySessions[day];

    // Day Header Bar
    ctx.fillStyle = '#EDEEEE'; // Mist
    ctx.strokeStyle = '#C7CCCE';
    ctx.lineWidth = 1;
    ctx.beginPath();
    drawRoundRect(ctx, 24, y, width - 48, 26, 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#202426';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(DAY_FULL_NAMES[day].toUpperCase(), 36, y + 17);

    y += 30;

    for (let i = 0; i < sessions.length; i++) {
      throwIfExportAborted(options?.signal);
      const s = sessions[i];
      const fullCourseLabel = `${s.courseName}${s.courseId ? ` (${s.courseId})` : ''}`;
      const middleWidth = width - 48 - 180 - 100;
      const wrappedLines = wrapCanvasText(ctx, fullCourseLabel, middleWidth);
      const rowHeight = Math.max(34, wrappedLines.length * 16 + 18);

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#C7CCCE';
      ctx.lineWidth = 1;
      ctx.beginPath();
      drawRoundRect(ctx, 24, y, width - 48, rowHeight, 2);
      ctx.fill();
      ctx.stroke();

      // Time (Left)
      ctx.fillStyle = '#415A63'; // Brand primary
      ctx.font = 'bold 11.5px "JetBrains Mono", monospace';
      ctx.fillText(`${s.start12} to ${s.end12}`, 36, y + 21);

      // Course Name (Middle - Full, Wrapped, Never Truncated)
      ctx.fillStyle = '#202426';
      ctx.font = `bold 12px ${EXPORT_FONT_STACK}`;
      let textLineY = y + 21;
      for (const line of wrappedLines) {
        ctx.fillText(line, 210, textLineY);
        textLineY += 16;
      }

      // Credits (Right)
      ctx.fillStyle = '#687074';
      ctx.font = `11px ${EXPORT_FONT_STACK}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${s.credits == null ? 'Unknown' : s.credits} Credits`, width - 36, y + 21);
      ctx.textAlign = 'left';

      y += rowHeight + 4;
      completedCanvasUnits += 1;
      reportCanvasProgress();
      if (completedCanvasUnits % 8 === 0) await yieldToBrowser(options?.signal);
    }

    y += 6;
  }

  // 6. Clean Footer: Gadwal only
  ctx.fillStyle = '#687074';
  ctx.font = `bold 11px ${EXPORT_FONT_STACK}`;
  ctx.fillText('Gadwal', 24, y + 14);

  throwIfExportAborted(options?.signal);
  reportCanvasProgress();
  return canvas;
}

/**
 * Downloads a single schedule as a PNG image.
 */
export async function downloadScheduleImage(schedule: OptimizationResult, rank: number = 1, options?: ExportTaskOptions): Promise<void> {
  const canvas = await renderScheduleToCanvas(schedule, rank, options);
  throwIfExportAborted(options?.signal);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas image conversion failed'));
        return;
      }
      deliverBlob(blob, `Gadwal-Schedule-${rank}.png`, `Gadwal Schedule Option ${rank}`).then(resolve).catch(reject);
    }, 'image/png');
  });
}

