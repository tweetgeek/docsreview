export type CommentStatus = 'open' | 'resolved';
export type RoundStatus = 'unchanged' | 'changed' | 'new';

export interface Anchor {
  snapshot: string;
  line: number;
  lineText: string;
}

export interface Comment {
  id: string;
  file: string;
  text: string;
  status: CommentStatus;
  createdAt: string;
  resolvedAt: string | null;
  handedOffAt: string | null;
  checkedAt: string | null;
  anchor: Anchor;
}

export interface Handoff {
  at: string;
  showIgnored: boolean;
  files: Record<string, string>;
}

export interface ReviewState {
  version: 1;
  root: string;
  showIgnored: boolean;
  handoff: Handoff | null;
  comments: Comment[];
}

export interface CurrentFile {
  lines: string[];
  hash: string;
}

export interface CommentView {
  id: string;
  file: string;
  text: string;
  status: CommentStatus;
  createdAt: string;
  resolvedAt: string | null;
  currentLine: number;
  lineChanged: boolean;
  previousLineText: string;
  handedOff: boolean;
  needsCheck: boolean;
  fileMissing: boolean;
}

export interface FileEntry {
  path: string;
  openComments: number;
  ignored: boolean;
  roundStatus: RoundStatus;
}

export interface FileView {
  path: string;
  content: string;
  contentHash: string;
  tooLarge: boolean;
  roundStatus: RoundStatus;
  changedLines: number[];
  comments: CommentView[];
}

export interface CommentsResponse {
  comments: CommentView[];
  output: string;
}

export interface SessionInfo {
  root: string;
  recent: string[];
  showIgnored: boolean;
  lastHandoffAt: string | null;
  warning: string | null;
}

export interface DirListing {
  path: string;
  parent: string | null;
  dirs: string[];
}

export type ServerEvent = { type: 'files-changed'; paths: string[] } | { type: 'review-changed' };
