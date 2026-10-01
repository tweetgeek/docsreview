import { describe, expect, it } from 'vitest';
import { changedLines, mapLine } from '../../src/core/anchors.js';
import { splitLines } from '../../src/core/lines.js';

describe('splitLines', () => {
  it('returns no lines for an empty file', () => {
    expect(splitLines('')).toEqual([]);
  });

  it('does not create an extra line for the trailing newline', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });

  it('keeps blank lines, including a blank last line', () => {
    expect(splitLines('a\n\nb\n\n')).toEqual(['a', '', 'b', '']);
  });

  it('strips carriage returns from CRLF files', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
  });
});

describe('mapLine', () => {
  it('keeps the line when nothing changed', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'b', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: false });
  });

  it('follows a line shifted down by an insertion above it', () => {
    expect(mapLine(['a', 'b', 'c'], ['x', 'a', 'b', 'c'], 2)).toEqual({ currentLine: 3, lineChanged: false });
  });

  it('follows a line shifted up by a deletion above it', () => {
    expect(mapLine(['x', 'a', 'b'], ['a', 'b'], 3)).toEqual({ currentLine: 2, lineChanged: false });
  });

  it('marks a replaced line as changed and stays on the replacement', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'B', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('moves a comment from a deleted middle line to the line that follows', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('moves a comment from a deleted last line to the new last line', () => {
    expect(mapLine(['a', 'b', 'c'], ['a', 'b'], 3)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('clamps to the last replacement line when many lines become fewer', () => {
    expect(mapLine(['a', 'b', 'c', 'd', 'e'], ['a', 'X', 'e'], 4)).toEqual({ currentLine: 2, lineChanged: true });
  });

  it('keeps the offset inside a replacement of equal size', () => {
    expect(mapLine(['a', 'b', 'c', 'd'], ['a', 'B', 'C', 'd'], 3)).toEqual({ currentLine: 3, lineChanged: true });
  });

  it('puts the comment on line 1 of an emptied file', () => {
    expect(mapLine(['a', 'b'], [], 2)).toEqual({ currentLine: 1, lineChanged: true });
  });

  it('stays on its own copy of a duplicated line when unrelated lines are inserted above', () => {
    const before = ['a', 'x', 'b', 'x', 'c'];
    const after = ['new', 'a', 'x', 'b', 'x', 'c'];
    expect(mapLine(before, after, 4)).toEqual({ currentLine: 5, lineChanged: false });
    expect(mapLine(before, after, 2)).toEqual({ currentLine: 3, lineChanged: false });
  });

  it('keeps a comment on a blank line between paragraphs when text is appended', () => {
    expect(mapLine(['a', '', 'b'], ['a', '', 'b', '', 'c'], 2)).toEqual({ currentLine: 2, lineChanged: false });
  });

  it('gives the same answer for CRLF and LF versions of a file', () => {
    const before = splitLines('a\r\nb\r\nc\r\n');
    const after = splitLines('a\nb\nc\n');
    expect(mapLine(before, after, 3)).toEqual({ currentLine: 3, lineChanged: false });
  });
});

describe('changedLines', () => {
  it('is empty for identical content', () => {
    expect(changedLines(['a', 'b'], ['a', 'b'])).toEqual([]);
  });

  it('lists replaced and inserted lines by their current numbers', () => {
    expect(changedLines(['a', 'b', 'c'], ['a', 'B', 'c', 'd', 'e'])).toEqual([2, 4, 5]);
  });

  it('does not mark anything for a pure deletion', () => {
    expect(changedLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([]);
  });

  it('marks every line of a file that was empty before', () => {
    expect(changedLines([], ['a', 'b'])).toEqual([1, 2]);
  });
});
