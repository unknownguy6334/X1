// Gadwal Technical Graphite course treatment.
// Course blocks are intentionally restrained: the supplied visual specification
// requires neutral surfaces and says not to turn the timetable into a rainbow.

export interface CourseColor {
  name: string;
  bgLight: string;
  borderLight: string;
  textLight: string;
  bgDark: string;
  borderDark: string;
  textDark: string;
  bgHex: string;
  borderHex: string;
  textHex: string;
  swatchHex: string;
}

const GRAPHITE_COURSE: CourseColor = {
  name: 'Technical Graphite',
  bgLight: '#F8F9F8',
  borderLight: '#C7CCCE',
  textLight: '#202426',
  bgDark: '#F8F9F8',
  borderDark: '#C7CCCE',
  textDark: '#202426',
  bgHex: '#F8F9F8',
  borderHex: '#C7CCCE',
  textHex: '#202426',
  swatchHex: '#415A63',
};

// Kept as a stable API for existing callers. Differentiation is structural
// (course name/code/time) rather than arbitrary decorative color.
export const COURSE_PALETTE: CourseColor[] = Array.from({ length: 12 }, () => ({ ...GRAPHITE_COURSE }));

export function getCourseColor(courseName: string, customColorIndex?: number, stableCourseId?: string): CourseColor {
  if (customColorIndex !== undefined && customColorIndex >= 0 && customColorIndex < COURSE_PALETTE.length) {
    return COURSE_PALETTE[customColorIndex];
  }
  return COURSE_PALETTE[0];
}

export function getSectionColor(section: { name: string; courseKey?: string; id?: string; colorIndex?: number }): CourseColor {
  return getCourseColor(section.name, section.colorIndex, section.courseKey || section.id);
}
