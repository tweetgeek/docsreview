import { resolvePosition } from './derive.js';
import type { CurrentFile, ReviewState } from './types.js';

export function performHandoff(
  state: ReviewState,
  files: Map<string, CurrentFile>,
  snapshots: Map<string, string[] | null>,
  at: string,
): ReviewState {
  const comments = state.comments.map((comment) => {
    const current = files.get(comment.file);
    if (comment.status !== 'open' || current === undefined) return comment;
    const snapshotLines = snapshots.get(comment.anchor.snapshot) ?? null;
    const { currentLine } = resolvePosition(comment, current, snapshotLines);
    return {
      ...comment,
      handedOffAt: at,
      checkedAt: null,
      anchor: {
        snapshot: current.hash,
        line: currentLine,
        lineText: current.lines[currentLine - 1] ?? '',
      },
    };
  });
  const hashes: Record<string, string> = {};
  for (const [path, file] of files) hashes[path] = file.hash;
  return {
    ...state,
    comments,
    handoff: { at, showIgnored: state.showIgnored, files: hashes },
  };
}
