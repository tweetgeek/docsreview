import { reactive } from 'vue';
import type { CommentsResponse, FileEntry, FileView, SessionInfo } from '../core/types.js';
import { api, ApiError, initToken, openEvents, type CommentPatch } from './api.js';
import { formatRoute, parseRoute, type Route } from './lib/route.js';
import { t } from './strings.js';

export interface Draft {
  line: number;
  pane: 'raw' | 'render';
  text: string;
}

interface Store {
  session: SessionInfo | null;
  files: FileEntry[];
  fileView: FileView | null;
  fileError: string | null;
  comments: CommentsResponse;
  route: Route;
  focusLine: number | null;
  connected: boolean;
  showResolved: boolean;
  draft: Draft | null;
  error: string | null;
  notice: string | null;
}

const REFRESH_DELAY_MS = 50;
const NOTICE_MS = 4000;

export const store = reactive<Store>({
  session: null,
  files: [],
  fileView: null,
  fileError: null,
  comments: { comments: [], output: '' },
  route: parseRoute(location.hash),
  focusLine: null,
  connected: true,
  showResolved: false,
  draft: null,
  error: null,
  notice: null,
});

let refreshTimer: number | null = null;
let noticeTimer: number | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showNotice(message: string): void {
  store.notice = message;
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    store.notice = null;
  }, NOTICE_MS);
}

async function loadFile(): Promise<void> {
  const path = store.route.file;
  if (path === null) {
    store.fileView = null;
    store.fileError = null;
    return;
  }
  try {
    const view = await api.file(path);
    if (store.route.file !== path) return;
    store.fileView = view;
    store.fileError = null;
  } catch (error) {
    if (store.route.file !== path) return;
    if (error instanceof ApiError && error.status === 404) {
      store.fileView = null;
      store.fileError = t.fileMissing;
    } else if (store.fileView === null) {
      store.fileError = messageOf(error);
    } else {
      store.error = messageOf(error);
    }
  }
}

function applyRoute(next: Route): void {
  const fileChanged = next.file !== store.route.file;
  store.route = next;
  if (fileChanged) {
    store.fileView = null;
    store.fileError = null;
    store.draft = null;
    void loadFile();
  }
}

export function navigate(change: Partial<Route>): void {
  const next: Route = { ...store.route, ...change };
  applyRoute(next);
  const hash = formatRoute(next);
  if (hash !== location.hash) location.hash = hash;
}

export function openFile(path: string, line: number | null = null): void {
  store.focusLine = line;
  navigate({ tab: 'files', file: path });
}

export async function refresh(): Promise<void> {
  try {
    const [session, files, comments] = await Promise.all([api.session(), api.files(), api.comments()]);
    store.session = session;
    store.files = files;
    store.comments = comments;
    if (store.route.file === null && files.length > 0) {
      navigate({ file: files[0]!.path });
      return;
    }
    await loadFile();
  } catch (error) {
    store.error = messageOf(error);
  }
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, REFRESH_DELAY_MS);
}

export async function init(): Promise<void> {
  initToken();
  window.addEventListener('hashchange', () => applyRoute(parseRoute(location.hash)));
  await refresh();
  openEvents(scheduleRefresh, (connected) => {
    const reconnected = connected && !store.connected;
    store.connected = connected;
    if (reconnected) scheduleRefresh();
  });
}

async function run(action: () => Promise<unknown>): Promise<boolean> {
  let ok = true;
  try {
    await action();
    store.error = null;
  } catch (error) {
    store.error = messageOf(error);
    ok = false;
  }
  await refresh();
  return ok;
}

export function startDraft(line: number, pane: Draft['pane']): void {
  if (!store.connected) return;
  store.draft = { line, pane, text: '' };
}

export async function submitDraft(text: string): Promise<void> {
  const view = store.fileView;
  const draft = store.draft;
  if (view === null || draft === null || text.trim() === '') return;
  draft.text = text;
  try {
    await api.addComment(view.path, draft.line, text, view.contentHash);
    store.draft = null;
    store.error = null;
  } catch (error) {
    const stale = error instanceof ApiError && error.status === 409;
    store.error = stale ? t.fileChangedWhileCommenting : messageOf(error);
  }
  await refresh();
}

export function updateComment(id: string, patch: CommentPatch): Promise<boolean> {
  return run(() => api.patchComment(id, patch));
}

export function removeComment(id: string): Promise<boolean> {
  return run(() => api.deleteComment(id));
}

export function removeResolved(): Promise<boolean> {
  return run(() => api.deleteResolved());
}

export function setShowIgnored(value: boolean): Promise<boolean> {
  return run(() => api.setShowIgnored(value));
}

export async function changeRoot(path: string): Promise<boolean> {
  try {
    await api.setRoot(path);
  } catch (error) {
    store.error = messageOf(error);
    return false;
  }
  store.error = null;
  navigate({ tab: 'files', file: null });
  await refresh();
  return true;
}

export async function copyAndHandOff(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(store.comments.output);
  } catch {
    store.error = t.copyFailed;
    return false;
  }
  const done = await run(() => api.handoff());
  if (done) showNotice(t.copied);
  return done;
}
