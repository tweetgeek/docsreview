import { describe, expect, it } from 'vitest';
import { performHandoff } from '../../src/core/handoff.js';
import type { CurrentFile, ReviewState } from '../../src/core/types.js';
import { makeComment } from '../helpers/factories.js';

const AT = '2026-10-01T12:30:00.000Z';

function makeState(overrides: Partial<ReviewState> = {}): ReviewState {
  return { version: 1, root: '/work', showIgnored: false, handoff: null, comments: [], ...overrides };
}

describe('performHandoff', () => {
  it('records the time, the showIgnored setting and the hash of every visible file', () => {
    const files = new Map<string, CurrentFile>([
      ['docs/a.md', { lines: ['a', 'b'], hash: 'hash-a' }],
      ['README.md', { lines: ['r'], hash: 'hash-r' }],
    ]);
    const next = performHandoff(makeState({ showIgnored: true }), files, new Map(), AT);
    expect(next.handoff).toEqual({
      at: AT,
      showIgnored: true,
      files: { 'docs/a.md': 'hash-a', 'README.md': 'hash-r' },
    });
  });

  it('re-anchors an open comment to its current line, text and file hash', () => {
    const state = makeState({ comments: [makeComment({ checkedAt: '2026-10-01T11:00:00.000Z' })] });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['x', 'a', 'b'], hash: 'hash-new' }]]);
    const snapshots = new Map<string, string[] | null>([['hash-old', ['a', 'b']]]);
    const [comment] = performHandoff(state, files, snapshots, AT).comments;
    expect(comment).toMatchObject({
      handedOffAt: AT,
      checkedAt: null,
      anchor: { snapshot: 'hash-new', line: 3, lineText: 'b' },
    });
  });

  it('re-anchors to the replacement text when the commented line changed', () => {
    const state = makeState({ comments: [makeComment()] });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['a', 'B'], hash: 'hash-new' }]]);
    const snapshots = new Map<string, string[] | null>([['hash-old', ['a', 'b']]]);
    const [comment] = performHandoff(state, files, snapshots, AT).comments;
    expect(comment!.anchor).toEqual({ snapshot: 'hash-new', line: 2, lineText: 'B' });
  });

  it('uses an empty line text when the file became empty', () => {
    const state = makeState({ comments: [makeComment()] });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: [], hash: 'hash-empty' }]]);
    const snapshots = new Map<string, string[] | null>([['hash-old', ['a', 'b']]]);
    const [comment] = performHandoff(state, files, snapshots, AT).comments;
    expect(comment!.anchor).toEqual({ snapshot: 'hash-empty', line: 1, lineText: '' });
  });

  it('leaves resolved comments untouched', () => {
    const resolved = makeComment({ status: 'resolved', resolvedAt: '2026-10-01T11:00:00.000Z' });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['x', 'a', 'b'], hash: 'hash-new' }]]);
    const next = performHandoff(makeState({ comments: [resolved] }), files, new Map(), AT);
    expect(next.comments[0]).toEqual(resolved);
  });

  it('leaves comments on missing files untouched', () => {
    const orphan = makeComment({ file: 'gone.md' });
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['a'], hash: 'hash-a' }]]);
    const next = performHandoff(makeState({ comments: [orphan] }), files, new Map(), AT);
    expect(next.comments[0]).toEqual(orphan);
  });

  it('does not modify the state it was given', () => {
    const state = makeState({ comments: [makeComment()] });
    const before = structuredClone(state);
    const files = new Map<string, CurrentFile>([['docs/a.md', { lines: ['x', 'a', 'b'], hash: 'hash-new' }]]);
    performHandoff(state, files, new Map([['hash-old', ['a', 'b']]]), AT);
    expect(state).toEqual(before);
  });
});
