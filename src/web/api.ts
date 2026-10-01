import type {
  CommentStatus,
  CommentsResponse,
  DirListing,
  FileEntry,
  FileView,
  SessionInfo,
} from '../core/types.js';
import { t } from './strings.js';

const TOKEN_KEY = 'docsreview-token';
let token = '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function initToken(): void {
  const fromUrl = new URLSearchParams(location.search).get('token');
  try {
    if (fromUrl !== null) sessionStorage.setItem(TOKEN_KEY, fromUrl);
    token = fromUrl ?? sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    token = fromUrl ?? '';
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, t.connectionLost);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `HTTP ${response.status}`);
  return data as T;
}

export interface CommentPatch {
  text?: string;
  status?: CommentStatus;
  checked?: true;
}

export const api = {
  session: () => request<SessionInfo>('GET', '/api/session'),
  setRoot: (path: string) => request<SessionInfo>('POST', '/api/root', { path }),
  dirs: (path?: string) =>
    request<DirListing>('GET', path === undefined ? '/api/dirs' : `/api/dirs?path=${encodeURIComponent(path)}`),
  setShowIgnored: (showIgnored: boolean) => request<unknown>('PATCH', '/api/review', { showIgnored }),
  files: () => request<FileEntry[]>('GET', '/api/files'),
  file: (path: string) => request<FileView>('GET', `/api/file?path=${encodeURIComponent(path)}`),
  comments: () => request<CommentsResponse>('GET', '/api/comments'),
  addComment: (file: string, line: number, text: string, contentHash: string) =>
    request<{ id: string }>('POST', '/api/comments', { file, line, text, contentHash }),
  patchComment: (id: string, patch: CommentPatch) =>
    request<unknown>('PATCH', `/api/comments/${encodeURIComponent(id)}`, patch),
  deleteComment: (id: string) => request<unknown>('DELETE', `/api/comments/${encodeURIComponent(id)}`),
  deleteResolved: () => request<unknown>('DELETE', '/api/comments?status=resolved'),
  handoff: () => request<unknown>('POST', '/api/handoff'),
};

export function openEvents(onChange: () => void, onStatus: (connected: boolean) => void): EventSource {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.addEventListener('open', () => onStatus(true));
  source.addEventListener('error', () => onStatus(false));
  source.addEventListener('files-changed', onChange);
  source.addEventListener('review-changed', onChange);
  return source;
}
