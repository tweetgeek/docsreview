import type { Comment, CommentView } from '../../src/core/types.js';

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    file: 'docs/a.md',
    text: 'uzasadnij wybór',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    handedOffAt: null,
    checkedAt: null,
    anchor: { snapshot: 'hash-old', line: 2, lineText: 'b' },
    ...overrides,
  };
}

export function makeView(overrides: Partial<CommentView> = {}): CommentView {
  return {
    id: 'c1',
    file: 'docs/a.md',
    text: 'uzasadnij wybór',
    status: 'open',
    createdAt: '2026-10-01T10:00:00.000Z',
    resolvedAt: null,
    currentLine: 2,
    lineChanged: false,
    previousLineText: 'b',
    handedOff: false,
    needsCheck: false,
    fileMissing: false,
    ...overrides,
  };
}
