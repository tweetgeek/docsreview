import { mapLine, type LinePosition } from './anchors.js';
import type { Comment, CommentView, CurrentFile, Handoff, RoundStatus } from './types.js';

export function resolvePosition(
  comment: Comment,
  current: CurrentFile | null,
  snapshotLines: string[] | null,
): LinePosition {
  if (current === null) return { currentLine: comment.anchor.line, lineChanged: false };
  if (current.hash === comment.anchor.snapshot) return { currentLine: comment.anchor.line, lineChanged: false };
  if (snapshotLines === null) {
    const lastLine = Math.max(current.lines.length, 1);
    return { currentLine: Math.min(Math.max(comment.anchor.line, 1), lastLine), lineChanged: true };
  }
  return mapLine(snapshotLines, current.lines, comment.anchor.line);
}

export function deriveCommentView(
  comment: Comment,
  handoff: Handoff | null,
  current: CurrentFile | null,
  snapshotLines: string[] | null,
): CommentView {
  const { currentLine, lineChanged } = resolvePosition(comment, current, snapshotLines);
  const handedOff = comment.status === 'open' && handoff !== null && comment.handedOffAt === handoff.at;
  return {
    id: comment.id,
    file: comment.file,
    text: comment.text,
    status: comment.status,
    createdAt: comment.createdAt,
    resolvedAt: comment.resolvedAt,
    currentLine,
    lineChanged,
    previousLineText: comment.anchor.lineText,
    handedOff,
    needsCheck: handedOff && lineChanged && comment.checkedAt === null,
    fileMissing: current === null,
  };
}

export function deriveRoundStatus(
  path: string,
  currentHash: string,
  ignored: boolean,
  handoff: Handoff | null,
): RoundStatus {
  if (handoff === null) return 'unchanged';
  if (!Object.hasOwn(handoff.files, path)) {
    return !ignored || handoff.showIgnored ? 'new' : 'unchanged';
  }
  return handoff.files[path] === currentHash ? 'unchanged' : 'changed';
}

export function compareViews(a: CommentView, b: CommentView): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.currentLine !== b.currentLine) return a.currentLine - b.currentLine;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return 0;
}
