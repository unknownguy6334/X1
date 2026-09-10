#!/usr/bin/env node
/**
 * Offline OCR quality benchmark helper.
 *
 * Usage:
 *   node scripts/benchmark-ocr-quality.mjs --gold gold.json --candidate current.json
 *   node scripts/benchmark-ocr-quality.mjs --gold gold.json --baseline baseline.json --candidate candidate.json
 *
 * Each JSON file may be either {sections:[...]} or an array of sections.
 * This does not call an OCR provider. It makes the accuracy decision reproducible once a
 * representative corpus has been labeled and provider outputs have been captured.
 */
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (!arg.startsWith('--')) return pairs;
  pairs.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return pairs;
}, []));

if (!args.gold || (!args.candidate && !args.baseline)) {
  console.error('Usage: --gold gold.json --candidate output.json [--baseline baseline.json]');
  process.exit(2);
}

const load = (file) => {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.sections) ? parsed.sections : []);
};
const norm = (value) => String(value ?? '').trim().toUpperCase().replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ');
const sectionKey = (section) => `${norm(section.courseCode || section.course_code || '')}|${norm(section.name || section.courseName || '')}|${norm(section.sectionCode || section.section_code || '')}`;
const meetingKey = (meeting) => `${norm(meeting.day || meeting.days)}|${norm(meeting.start || meeting.start_time)}|${norm(meeting.end || meeting.end_time)}|${norm(meeting.type || meeting.meeting_type || 'OTHER')}`;
const flatten = (sections) => {
  const keys = new Set();
  for (const section of sections) {
    const base = sectionKey(section);
    const meetings = Array.isArray(section.sessions || section.meetings) ? (section.sessions || section.meetings) : [];
    if (!meetings.length) keys.add(`${base}|<NO_MEETING>`);
    for (const meeting of meetings) keys.add(`${base}|${meetingKey(meeting)}`);
  }
  return keys;
};

const score = (goldFile, candidateFile) => {
  const gold = flatten(load(goldFile));
  const candidate = flatten(load(candidateFile));
  let hit = 0;
  for (const key of gold) if (candidate.has(key)) hit++;
  const recall = gold.size ? hit / gold.size : 1;
  const precision = candidate.size ? hit / candidate.size : (gold.size ? 0 : 1);
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return { gold: gold.size, candidate: candidate.size, hit, recall, precision, f1 };
};

const print = (label, result) => console.log(`${label}: recall ${(result.recall * 100).toFixed(1)}% | precision ${(result.precision * 100).toFixed(1)}% | F1 ${(result.f1 * 100).toFixed(1)}% | matched ${result.hit}/${result.gold}`);

if (args.candidate) print('Candidate', score(args.gold, args.candidate));
if (args.baseline) print('Baseline', score(args.gold, args.baseline));
if (args.baseline && args.candidate) {
  const baseline = score(args.gold, args.baseline);
  const candidate = score(args.gold, args.candidate);
  console.log(`Delta: recall ${((candidate.recall - baseline.recall) * 100).toFixed(1)}pp | precision ${((candidate.precision - baseline.precision) * 100).toFixed(1)}pp | F1 ${((candidate.f1 - baseline.f1) * 100).toFixed(1)}pp`);
}
