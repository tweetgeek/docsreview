export const FONT_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const DEFAULT_FONT_SCALE = 1;

export function largerFontScale(scale: number): number {
  return FONT_SCALES.find((step) => step > scale) ?? FONT_SCALES.at(-1)!;
}

export function smallerFontScale(scale: number): number {
  return [...FONT_SCALES].reverse().find((step) => step < scale) ?? FONT_SCALES[0]!;
}

export function parseFontScale(value: string | null): number {
  const scale = Number(value);
  return value !== null && FONT_SCALES.includes(scale) ? scale : DEFAULT_FONT_SCALE;
}

export function formatFontScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
