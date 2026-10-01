import { describe, expect, it } from 'vitest';
import { deriveCommentView, deriveRoundStatus } from '../../src/core/derive.js';
import type { Handoff } from '../../src/core/types.js';
import { makeComment } from '../helpers/factories.js';

const handoff: Handoff = { at: '2026-10-01T12:00:00.000Z', showIgnored: false, files: { 'docs/a.md': 'hash-old' } };

describe('deriveCommentView', () => {
  it('keeps the anchor line when the file is unchanged', () => {
    const view = deriveCommentView(makeComment(), null, { lines: ['a', 'b'], hash: 'hash-old' }, null);
    expect(view).toMatchObject({ currentLine: 2, lineChanged: false, previousLineText: 'b', fileMissing: false });
  });

  it('maps the anchor through the snapshot when the file changed', () => {
    const view = deriveCommentView(makeComment(), null, { lines: ['x', 'a', 'B'], hash: 'hash-new' }, ['a', 'b']);
    expect(view).toMatchObject({ currentLine: 3, lineChanged: true });
  });

  it('marks the file as missing and keeps the anchor line', () => {
    const view = deriveCommentView(makeComment(), null, null, null);
    expect(view).toMatchObject({ currentLine: 2, lineChanged: false, fileMissing: true });
  });

  it('clamps to the file length and marks the line changed when the snapshot is gone', () => {
    const comment = makeComment({ anchor: { snapshot: 'hash-old', line: 9, lineText: 'z' } });
    const view = deriveCommentView(comment, null, { lines: ['a', 'b', 'c'], hash: 'hash-new' }, null);
    expect(view).toMatchObject({ currentLine: 3, lineChanged: true });
  });

  it('is handed off only when it was part of the last handoff', () => {
    const current = { lines: ['a', 'b'], hash: 'hash-old' };
    expect(deriveCommentView(makeComment({ handedOffAt: handoff.at }), handoff, current, null).handedOff).toBe(true);
    expect(deriveCommentView(makeComment({ handedOffAt: '2026-09-30T08:00:00.000Z' }), handoff, current, null).handedOff).toBe(false);
    expect(deriveCommentView(makeComment({ handedOffAt: null }), handoff, current, null).handedOff).toBe(false);
  });

  it('is not handed off once resolved, and is again after reopening in the same round', () => {
    const current = { lines: ['a', 'b'], hash: 'hash-old' };
    const resolved = makeComment({ handedOffAt: handoff.at, status: 'resolved', resolvedAt: '2026-10-01T13:00:00.000Z' });
    expect(deriveCommentView(resolved, handoff, current, null).handedOff).toBe(false);
    const reopened = { ...resolved, status: 'open' as const, resolvedAt: null };
    expect(deriveCommentView(reopened, handoff, current, null).handedOff).toBe(true);
  });

  it('needs a check when handed off, changed and not yet checked', () => {
    const current = { lines: ['a', 'B'], hash: 'hash-new' };
    const comment = makeComment({ handedOffAt: handoff.at });
    expect(deriveCommentView(comment, handoff, current, ['a', 'b']).needsCheck).toBe(true);
    const checked = { ...comment, checkedAt: '2026-10-01T13:00:00.000Z' };
    expect(deriveCommentView(checked, handoff, current, ['a', 'b']).needsCheck).toBe(false);
  });

  it('does not need a check when the line is unchanged or the comment was never handed off', () => {
    const changed = { lines: ['a', 'B'], hash: 'hash-new' };
    expect(deriveCommentView(makeComment(), handoff, changed, ['a', 'b']).needsCheck).toBe(false);
    const shifted = { lines: ['x', 'a', 'b'], hash: 'hash-new' };
    const handedOff = makeComment({ handedOffAt: handoff.at });
    expect(deriveCommentView(handedOff, handoff, shifted, ['a', 'b']).needsCheck).toBe(false);
  });
});

describe('deriveRoundStatus', () => {
  it('is unchanged before the first handoff', () => {
    expect(deriveRoundStatus('docs/a.md', 'anything', false, null)).toBe('unchanged');
  });

  it('compares the hash for files that were part of the handoff', () => {
    expect(deriveRoundStatus('docs/a.md', 'hash-old', false, handoff)).toBe('unchanged');
    expect(deriveRoundStatus('docs/a.md', 'hash-new', false, handoff)).toBe('changed');
  });

  it('marks a file that was not part of the handoff as new', () => {
    expect(deriveRoundStatus('docs/b.md', 'h', false, handoff)).toBe('new');
  });

  it('does not call an ignored file new when ignored files were hidden at handoff', () => {
    expect(deriveRoundStatus('vendor/x.md', 'h', true, handoff)).toBe('unchanged');
    expect(deriveRoundStatus('vendor/x.md', 'h', true, { ...handoff, showIgnored: true })).toBe('new');
  });

  it('is not confused by file names that match object prototype members', () => {
    expect(deriveRoundStatus('constructor', 'h', false, handoff)).toBe('new');
  });
});
