import { compareViews } from './derive.js';
import type { CommentView } from './types.js';

export function buildOutput(comments: CommentView[]): string {
  return comments
    .filter((comment) => comment.status === 'open' && !comment.fileMissing)
    .sort(compareViews)
    .map((comment) => `### ${comment.file}:${comment.currentLine} > ${comment.text}`)
    .join('\n\n');
}
