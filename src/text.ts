export const FONT_SIZE = 12;
export const LINE_HEIGHT = 15;

// Estimated from Helvetica's advance widths, which draw.io uses by default. Measuring with a real
// font would need a font file and a rendering library just to reserve roughly enough room.
const NARROW = new Set("iIl.,:;|!'`()[]{} ");
const WIDE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u;

function charWidth(char: string): number {
  if (WIDE.test(char)) return 1;
  if (NARROW.has(char)) return 0.3;
  if (/[A-Z0-9mwMW]/.test(char)) return 0.68;
  return 0.55;
}

export function textWidth(text: string, fontSize = FONT_SIZE): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return Math.ceil(width * fontSize);
}

export function labelSize(label: string): { width: number; height: number } {
  const lines = label === '' ? [] : label.split('\n');
  return {
    width: Math.max(0, ...lines.map((line) => textWidth(line))),
    height: lines.length * LINE_HEIGHT,
  };
}
