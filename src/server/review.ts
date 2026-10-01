import { randomUUID } from 'node:crypto';
import { changedLines } from '../core/anchors.js';
import { compareViews, deriveCommentView, deriveRoundStatus } from '../core/derive.js';
import { performHandoff } from '../core/handoff.js';
import { splitLines } from '../core/lines.js';
import { buildOutput } from '../core/output.js';
import type {
  CommentView,
  CommentsResponse,
  CurrentFile,
  FileEntry,
  FileView,
  ReviewState,
  RoundStatus,
  SessionInfo,
} from '../core/types.js';
import { HttpError } from './errors.js';
import { MAX_RENDER_BYTES, normalizeRelPath, readDiskFile, type DiskFile } from './files.js';
import { isPathIgnored } from './ignore.js';
import { scanFiles } from './scanner.js';
import { collectGarbage, readSnapshot, saveSnapshot } from './snapshots.js';
import { getWarning, loadRecent, loadState, updateState } from './store.js';

type SnapshotCache = Map<string, string[] | null>;

export interface NewComment {
  file?: unknown;
  line?: unknown;
  text?: unknown;
  contentHash?: unknown;
}

export interface CommentPatch {
  text?: unknown;
  status?: unknown;
  checked?: unknown;
}

function commentedFiles(state: ReviewState): string[] {
  return [...new Set(state.comments.map((comment) => comment.file))];
}

async function safeRead(root: string, file: string): Promise<DiskFile | null> {
  try {
    return await readDiskFile(root, file);
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
}

async function snapshotLines(root: string, hash: string, cache: SnapshotCache): Promise<string[] | null> {
  if (!cache.has(hash)) {
    const content = await readSnapshot(root, hash);
    cache.set(hash, content === null ? null : splitLines(content));
  }
  return cache.get(hash) ?? null;
}

async function viewsForFile(
  root: string,
  state: ReviewState,
  file: string,
  disk: DiskFile | null,
  cache: SnapshotCache,
): Promise<CommentView[]> {
  const views: CommentView[] = [];
  for (const comment of state.comments) {
    if (comment.file !== file) continue;
    const needsSnapshot = disk !== null && disk.hash !== comment.anchor.snapshot;
    const snapshot = needsSnapshot ? await snapshotLines(root, comment.anchor.snapshot, cache) : null;
    views.push(deriveCommentView(comment, state.handoff, disk, snapshot));
  }
  return views;
}

function cleanText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') throw new HttpError(400, 'Komentarz nie może być pusty');
  return text;
}

export async function getSession(root: string): Promise<SessionInfo> {
  const state = await loadState(root);
  return {
    root,
    recent: await loadRecent(),
    showIgnored: state.showIgnored,
    lastHandoffAt: state.handoff?.at ?? null,
    warning: getWarning(root),
  };
}

export async function setShowIgnored(root: string, value: unknown): Promise<void> {
  if (typeof value !== 'boolean') throw new HttpError(400, 'Nieprawidłowa wartość showIgnored');
  await updateState(root, (state) => ({ ...state, showIgnored: value }));
}

export async function listFiles(root: string): Promise<FileEntry[]> {
  const state = await loadState(root);
  const scanned = await scanFiles(root, { showIgnored: state.showIgnored, alwaysInclude: commentedFiles(state) });
  const entries: FileEntry[] = [];
  for (const file of scanned) {
    let roundStatus: RoundStatus = 'unchanged';
    if (state.handoff !== null) {
      const tracked = Object.hasOwn(state.handoff.files, file.path);
      const disk = tracked ? await safeRead(root, file.path) : null;
      if (!tracked || disk !== null) {
        roundStatus = deriveRoundStatus(file.path, disk?.hash ?? '', file.ignored, state.handoff);
      }
    }
    const openComments = state.comments.filter(
      (comment) => comment.file === file.path && comment.status === 'open',
    ).length;
    entries.push({ path: file.path, openComments, ignored: file.ignored, roundStatus });
  }
  return entries;
}

export async function getFileView(root: string, rawPath: unknown): Promise<FileView> {
  const file = normalizeRelPath(rawPath);
  const disk = await readDiskFile(root, file);
  if (disk === null) throw new HttpError(404, 'Plik nie istnieje');
  const state = await loadState(root);
  const cache: SnapshotCache = new Map();

  const tracked = state.handoff !== null && Object.hasOwn(state.handoff.files, file);
  const ignored = state.handoff !== null && !tracked ? await isPathIgnored(root, file) : false;
  const roundStatus = deriveRoundStatus(file, disk.hash, ignored, state.handoff);
  let changed: number[] = [];
  if (roundStatus === 'changed' && state.handoff !== null) {
    const before = await snapshotLines(root, state.handoff.files[file]!, cache);
    if (before !== null) changed = changedLines(before, disk.lines);
  }
  const comments = (await viewsForFile(root, state, file, disk, cache)).sort(compareViews);
  return {
    path: file,
    content: disk.content,
    contentHash: disk.hash,
    tooLarge: disk.bytes > MAX_RENDER_BYTES,
    roundStatus,
    changedLines: changed,
    comments,
  };
}

export async function listComments(root: string): Promise<CommentsResponse> {
  const state = await loadState(root);
  const cache: SnapshotCache = new Map();
  const comments: CommentView[] = [];
  for (const file of commentedFiles(state)) {
    const disk = await safeRead(root, file);
    comments.push(...(await viewsForFile(root, state, file, disk, cache)));
  }
  comments.sort(compareViews);
  return { comments, output: buildOutput(comments) };
}

export async function addComment(root: string, input: NewComment): Promise<string> {
  const file = normalizeRelPath(input.file);
  const text = cleanText(input.text);
  const disk = await readDiskFile(root, file);
  if (disk === null) throw new HttpError(404, 'Plik nie istnieje');
  if (disk.hash !== input.contentHash) throw new HttpError(409, 'Plik zmienił się od wyświetlenia');
  const line = input.line;
  if (typeof line !== 'number' || !Number.isInteger(line) || line < 1 || line > disk.lines.length) {
    throw new HttpError(400, 'Nieprawidłowy numer linii');
  }
  const id = randomUUID();
  await updateState(root, async (state) => {
    await saveSnapshot(root, disk.content);
    return {
      ...state,
      comments: [
        ...state.comments,
        {
          id,
          file,
          text,
          status: 'open',
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          handedOffAt: null,
          checkedAt: null,
          anchor: { snapshot: disk.hash, line, lineText: disk.lines[line - 1] ?? '' },
        },
      ],
    };
  });
  return id;
}

export async function patchComment(root: string, id: string, patch: CommentPatch): Promise<void> {
  const text = patch.text === undefined ? undefined : cleanText(patch.text);
  if (patch.status !== undefined && patch.status !== 'open' && patch.status !== 'resolved') {
    throw new HttpError(400, 'Nieprawidłowy status');
  }
  await updateState(root, (state) => {
    const index = state.comments.findIndex((comment) => comment.id === id);
    if (index === -1) throw new HttpError(404, 'Komentarz nie istnieje');
    const now = new Date().toISOString();
    let comment = state.comments[index]!;
    if (text !== undefined) comment = { ...comment, text, checkedAt: now };
    if (patch.status === 'resolved') comment = { ...comment, status: 'resolved', resolvedAt: now };
    if (patch.status === 'open') comment = { ...comment, status: 'open', resolvedAt: null };
    if (patch.checked === true) comment = { ...comment, checkedAt: now };
    const comments = [...state.comments];
    comments[index] = comment;
    return { ...state, comments };
  });
}

export async function deleteComment(root: string, id: string): Promise<void> {
  await updateState(
    root,
    (current) => {
      if (!current.comments.some((comment) => comment.id === id)) throw new HttpError(404, 'Komentarz nie istnieje');
      return { ...current, comments: current.comments.filter((comment) => comment.id !== id) };
    },
    (state) => collectGarbage(root, state),
  );
}

export async function deleteResolved(root: string): Promise<void> {
  await updateState(
    root,
    (current) => ({
      ...current,
      comments: current.comments.filter((comment) => comment.status !== 'resolved'),
    }),
    (state) => collectGarbage(root, state),
  );
}

export async function handoff(root: string): Promise<void> {
  await updateState(
    root,
    async (current) => {
      const scanned = await scanFiles(root, {
        showIgnored: current.showIgnored,
        alwaysInclude: commentedFiles(current),
      });
      const disks = new Map<string, DiskFile>();
      for (const entry of scanned) {
        const disk = await safeRead(root, entry.path);
        if (disk !== null) disks.set(entry.path, disk);
      }
      const open = current.comments.filter((comment) => comment.status === 'open' && disks.has(comment.file));
      if (open.length === 0) throw new HttpError(409, 'Brak otwartych komentarzy do przekazania');

      const cache: SnapshotCache = new Map();
      for (const comment of open) await snapshotLines(root, comment.anchor.snapshot, cache);
      const files = new Map<string, CurrentFile>();
      for (const [file, disk] of disks) {
        await saveSnapshot(root, disk.content);
        files.set(file, { lines: disk.lines, hash: disk.hash });
      }
      return performHandoff(current, files, cache, new Date().toISOString());
    },
    (state) => collectGarbage(root, state),
  );
}
