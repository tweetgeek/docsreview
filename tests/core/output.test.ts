import { describe, expect, it } from 'vitest';
import { buildOutput } from '../../src/core/output.js';
import { makeView } from '../helpers/factories.js';

describe('buildOutput', () => {
  it('is empty when there are no comments', () => {
    expect(buildOutput([])).toBe('');
  });

  it('formats one comment as "### path:line > text"', () => {
    expect(buildOutput([makeView({ file: 'docs/a.md', currentLine: 8, text: 'uzasadnij wybór' })])).toBe(
      '### docs/a.md:8 > uzasadnij wybór',
    );
  });

  it('separates comments with one blank line and adds no trailing newline', () => {
    const output = buildOutput([
      makeView({ id: '1', file: 'a.md', currentLine: 1, text: 'pierwszy' }),
      makeView({ id: '2', file: 'a.md', currentLine: 5, text: 'drugi' }),
    ]);
    expect(output).toBe('### a.md:1 > pierwszy\n\n### a.md:5 > drugi');
  });

  it('sorts by path, then line, then creation time', () => {
    const output = buildOutput([
      makeView({ id: '1', file: 'b.md', currentLine: 1, text: 'b1' }),
      makeView({ id: '2', file: 'a.md', currentLine: 9, text: 'a9' }),
      makeView({ id: '3', file: 'a.md', currentLine: 2, text: 'a2-later', createdAt: '2026-10-01T11:00:00.000Z' }),
      makeView({ id: '4', file: 'a.md', currentLine: 2, text: 'a2-earlier', createdAt: '2026-10-01T09:00:00.000Z' }),
      makeView({ id: '5', file: 'Z.md', currentLine: 1, text: 'Z1' }),
    ]);
    expect(output.split('\n\n')).toEqual([
      '### Z.md:1 > Z1',
      '### a.md:2 > a2-earlier',
      '### a.md:2 > a2-later',
      '### a.md:9 > a9',
      '### b.md:1 > b1',
    ]);
  });

  it('keeps the following lines of a multi-line comment unchanged', () => {
    expect(buildOutput([makeView({ file: 'a.md', currentLine: 3, text: 'pierwsza linia\ndruga linia' })])).toBe(
      '### a.md:3 > pierwsza linia\ndruga linia',
    );
  });

  it('leaves out resolved comments and comments on missing files', () => {
    const output = buildOutput([
      makeView({ id: '1', file: 'a.md', text: 'otwarty' }),
      makeView({ id: '2', file: 'a.md', text: 'rozwiązany', status: 'resolved' }),
      makeView({ id: '3', file: 'gone.md', text: 'bez pliku', fileMissing: true }),
    ]);
    expect(output).toBe('### a.md:2 > otwarty');
  });

  it('does not reorder the array it was given', () => {
    const views = [makeView({ id: '1', file: 'b.md' }), makeView({ id: '2', file: 'a.md' })];
    buildOutput(views);
    expect(views.map((view) => view.id)).toEqual(['1', '2']);
  });
});
