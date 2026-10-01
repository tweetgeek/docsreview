import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../../src/core/types.js';
import { findBlockIndex } from '../../src/web/lib/blocks.js';
import { formatRoute, parseRoute } from '../../src/web/lib/route.js';
import { buildTree } from '../../src/web/lib/tree.js';
import { needsCheckQuestion } from '../../src/web/strings.js';

function entry(path: string, overrides: Partial<FileEntry> = {}): FileEntry {
  return { path, openComments: 0, ignored: false, roundStatus: 'unchanged', ...overrides };
}

describe('findBlockIndex', () => {
  const blocks = [
    { start: 1, end: 1 },
    { start: 3, end: 4 },
    { start: 7, end: 9 },
    { start: 8, end: 9 },
    { start: 12, end: 12 },
  ];

  it('returns the block that contains the line', () => {
    expect(findBlockIndex(blocks, 4)).toBe(1);
  });

  it('prefers the innermost of nested blocks', () => {
    expect(findBlockIndex(blocks, 8)).toBe(3);
    expect(findBlockIndex(blocks, 7)).toBe(2);
  });

  it('falls back to the nearest block above a line that belongs to no block', () => {
    expect(findBlockIndex(blocks, 5)).toBe(1);
    expect(findBlockIndex(blocks, 11)).toBe(3);
    expect(findBlockIndex(blocks, 99)).toBe(4);
  });

  it('falls back to the first block for a line above every block', () => {
    expect(findBlockIndex([{ start: 3, end: 4 }], 1)).toBe(0);
  });

  it('returns -1 when there are no blocks', () => {
    expect(findBlockIndex([], 1)).toBe(-1);
  });
});

describe('buildTree', () => {
  it('nests files in directories, directories first, sorted by name', () => {
    const tree = buildTree([entry('README.md'), entry('docs/b.md'), entry('docs/adr/0001.md'), entry('docs/a.md')]);
    expect(tree.map((node) => node.name)).toEqual(['docs', 'README.md']);
    const docs = tree[0]!;
    expect(docs).toMatchObject({ path: 'docs', file: null });
    expect(docs.children.map((node) => node.name)).toEqual(['adr', 'a.md', 'b.md']);
    expect(docs.children[0]!.children[0]).toMatchObject({ name: '0001.md', path: 'docs/adr/0001.md' });
  });

  it('marks a directory as ignored only when everything inside it is ignored', () => {
    const tree = buildTree([
      entry('vendor/pkg/README.md', { ignored: true }),
      entry('docs/a.md'),
      entry('docs/local.md', { ignored: true }),
    ]);
    expect(tree.map((node) => [node.name, node.ignored])).toEqual([
      ['docs', false],
      ['vendor', true],
    ]);
    expect(tree[1]!.children[0]).toMatchObject({ name: 'pkg', ignored: true });
  });

  it('sums open comments of the files inside a directory', () => {
    const tree = buildTree([
      entry('docs/a.md', { openComments: 2 }),
      entry('docs/adr/0001.md', { openComments: 1 }),
      entry('README.md'),
    ]);
    expect(tree.map((node) => [node.name, node.openComments])).toEqual([
      ['docs', 3],
      ['README.md', 0],
    ]);
  });

  it('returns an empty tree for no files', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('route', () => {
  it('defaults to the files tab with nothing selected', () => {
    expect(parseRoute('')).toEqual({ tab: 'files', file: null });
  });

  it('round-trips a file name with spaces, Polish letters and a hash sign', () => {
    const route = { tab: 'comments' as const, file: 'docs/Plan wdrożenia #2.md' };
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('falls back to the files tab for an unknown tab', () => {
    expect(parseRoute('#tab=settings&file=a.md')).toEqual({ tab: 'files', file: 'a.md' });
  });
});

describe('needsCheckQuestion', () => {
  it('uses the right Polish plural form', () => {
    expect(needsCheckQuestion(1)).toBe('1 komentarz z poprzedniej rundy ma zmienioną linię.');
    expect(needsCheckQuestion(2)).toBe('2 komentarze z poprzedniej rundy mają zmienioną linię.');
    expect(needsCheckQuestion(5)).toBe('5 komentarzy z poprzedniej rundy ma zmienioną linię.');
    expect(needsCheckQuestion(12)).toBe('12 komentarzy z poprzedniej rundy ma zmienioną linię.');
    expect(needsCheckQuestion(22)).toBe('22 komentarze z poprzedniej rundy mają zmienioną linię.');
  });
});
