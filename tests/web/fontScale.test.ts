import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALES,
  formatFontScale,
  largerFontScale,
  parseFontScale,
  smallerFontScale,
} from '../../src/web/lib/fontScale.js';

describe('font scale', () => {
  it('offers steps from 80% to 200% with 100% as the default', () => {
    expect(FONT_SCALES).toEqual([0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]);
    expect(DEFAULT_FONT_SCALE).toBe(1);
  });

  it('moves one step up and stops at the largest', () => {
    expect(largerFontScale(1)).toBe(1.1);
    expect(largerFontScale(1.75)).toBe(2);
    expect(largerFontScale(2)).toBe(2);
  });

  it('moves one step down and stops at the smallest', () => {
    expect(smallerFontScale(1)).toBe(0.9);
    expect(smallerFontScale(0.9)).toBe(0.8);
    expect(smallerFontScale(0.8)).toBe(0.8);
  });

  it('steps from a value that is not on the list to its neighbours', () => {
    expect(largerFontScale(1.2)).toBe(1.25);
    expect(smallerFontScale(1.2)).toBe(1.1);
  });

  it('reads a stored value and falls back to the default for anything else', () => {
    expect(parseFontScale('1.25')).toBe(1.25);
    expect(parseFontScale('0.8')).toBe(0.8);
    expect(parseFontScale(null)).toBe(1);
    expect(parseFontScale('')).toBe(1);
    expect(parseFontScale('abc')).toBe(1);
    expect(parseFontScale('3')).toBe(1);
    expect(parseFontScale('1.3')).toBe(1);
  });

  it('formats the scale as a percentage', () => {
    expect(formatFontScale(1)).toBe('100%');
    expect(formatFontScale(1.25)).toBe('125%');
    expect(formatFontScale(0.8)).toBe('80%');
  });
});
