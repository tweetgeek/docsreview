import fs from 'node:fs/promises';
import path from 'node:path';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommentsResponse, FileEntry, FileView, ServerEvent, SessionInfo } from '../../src/core/types.js';
import { createApp, type AppContext } from '../../src/server/app.js';
import { EventHub } from '../../src/server/events.js';
import { assertReadableDir } from '../../src/server/files.js';
import { createToken, isAllowedUrl, tokenMatches } from '../../src/server/security.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

const TOKEN = 'test-token';
const PORT = 4477;
const ORIGIN = `http://127.0.0.1:${PORT}`;

let ws: Workspace;
let app: Hono;
let ctx: AppContext;
let events: ServerEvent[];

beforeEach(async () => {
  ws = await makeWorkspace();
  let root = ws.root;
  const hub = new EventHub();
  events = [];
  hub.subscribe((event) => events.push(event));
  ctx = {
    token: TOKEN,
    port: PORT,
    webDir: null,
    hub,
    getRoot: () => root,
    setRoot: async (dir) => {
      root = await assertReadableDir(dir);
    },
  };
  app = createApp(ctx);
});

afterEach(async () => {
  await ws.cleanup();
});

function call(method: string, url: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(`${ORIGIN}${url}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function json<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await call(method, url, body);
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as T;
}

describe('security helpers', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abd', 'abc')).toBe(false);
    expect(tokenMatches('abcd', 'abc')).toBe(false);
    expect(tokenMatches(undefined, 'abc')).toBe(false);
  });

  it('accepts only loopback hosts on the server port', () => {
    expect(isAllowedUrl('http://127.0.0.1:4477/api/files', 4477)).toBe(true);
    expect(isAllowedUrl('http://localhost:4477/api/files', 4477)).toBe(true);
    expect(isAllowedUrl('http://127.0.0.1:4478/api/files', 4477)).toBe(false);
    expect(isAllowedUrl('http://evil.example:4477/api/files', 4477)).toBe(false);
    expect(isAllowedUrl('http://127.0.0.1.evil.example:4477/api/files', 4477)).toBe(false);
    expect(isAllowedUrl('not a url', 4477)).toBe(false);
  });

  it('treats an empty DOCSREVIEW_TOKEN as unset', () => {
    const previous = process.env.DOCSREVIEW_TOKEN;
    process.env.DOCSREVIEW_TOKEN = '';
    try {
      expect(createToken()).toMatch(/^[0-9a-f]{48}$/);
    } finally {
      if (previous === undefined) delete process.env.DOCSREVIEW_TOKEN;
      else process.env.DOCSREVIEW_TOKEN = previous;
    }
  });
});

describe('API access', () => {
  it('answers 401 without a token and with a wrong token', async () => {
    expect((await app.request(`${ORIGIN}/api/session`)).status).toBe(401);
    const wrong = await app.request(`${ORIGIN}/api/session`, { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('answers 403 for a foreign Host even with a valid token', async () => {
    const response = await app.request(`http://evil.example:${PORT}/api/session`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(403);
  });

  it('answers 401 for the event stream without a token', async () => {
    expect((await app.request(`${ORIGIN}/api/events`)).status).toBe(401);
    expect((await app.request(`${ORIGIN}/api/events?token=`)).status).toBe(401);
  });

  it('does not accept the token as a query parameter outside the event stream', async () => {
    expect((await app.request(`${ORIGIN}/api/session?token=${TOKEN}`)).status).toBe(401);
  });

  it('answers 404 as JSON for an unknown API path', async () => {
    const response = await call('GET', '/api/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Nie znaleziono' });
  });
});

describe('API routes', () => {
  it('returns the session', async () => {
    const session = await json<SessionInfo>('GET', '/api/session');
    expect(session).toEqual({ root: ws.root, recent: [], showIgnored: false, lastHandoffAt: null, warning: null });
  });

  it('runs a comment through its whole life', async () => {
    await ws.write('docs/Plan wdrożenia #2.md', 'one\ntwo\n');
    const filePath = 'docs/Plan wdrożenia #2.md';
    const files = await json<FileEntry[]>('GET', '/api/files');
    expect(files.map((file) => file.path)).toEqual([filePath]);

    const view = await json<FileView>('GET', `/api/file?path=${encodeURIComponent(filePath)}`);
    const created = await call('POST', '/api/comments', {
      file: filePath,
      line: 2,
      text: 'popraw',
      contentHash: view.contentHash,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    let comments = await json<CommentsResponse>('GET', '/api/comments');
    expect(comments.output).toBe(`### ${filePath}:2 > popraw`);

    await json('POST', '/api/handoff');
    await json('PATCH', `/api/comments/${id}`, { status: 'resolved' });
    comments = await json<CommentsResponse>('GET', '/api/comments');
    expect(comments.output).toBe('');

    await json('DELETE', '/api/comments?status=resolved');
    comments = await json<CommentsResponse>('GET', '/api/comments');
    expect(comments.comments).toEqual([]);
    expect(events.filter((event) => event.type === 'review-changed')).toHaveLength(4);
  });

  it('passes service errors through with their status and message', async () => {
    await ws.write('a.md', 'one\n');
    const stale = await call('POST', '/api/comments', { file: 'a.md', line: 1, text: 'x', contentHash: 'old' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'Plik zmienił się od wyświetlenia' });
    expect((await call('GET', '/api/file?path=missing.md')).status).toBe(404);
    expect((await call('GET', '/api/file?path=../x.md')).status).toBe(403);
    expect((await call('GET', '/api/file')).status).toBe(400);
    expect((await call('POST', '/api/handoff')).status).toBe(409);
    expect((await call('DELETE', '/api/comments')).status).toBe(400);
    expect((await call('DELETE', '/api/comments/nope')).status).toBe(404);
  });

  it('answers 400 for a body that is not a JSON object', async () => {
    const response = await app.request(`${ORIGIN}/api/comments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('switches the show-ignored setting', async () => {
    await ws.write('.gitignore', 'x.md\n');
    await ws.write('x.md', 'x\n');
    expect(await json<FileEntry[]>('GET', '/api/files')).toEqual([]);
    await json('PATCH', '/api/review', { showIgnored: true });
    expect((await json<FileEntry[]>('GET', '/api/files')).map((file) => file.path)).toEqual(['x.md']);
  });

  it('lists subdirectories and never files', async () => {
    await ws.write('docs/a.md', 'x\n');
    await ws.write('top.md', 'x\n');
    await fs.mkdir(path.join(ws.root, '.claude'));
    const listing = await json<{ path: string; parent: string; dirs: string[] }>(
      'GET',
      `/api/dirs?path=${encodeURIComponent(ws.root)}`,
    );
    expect(listing).toEqual({ path: ws.root, parent: path.dirname(ws.root), dirs: ['.claude', 'docs'] });
  });

  it('resolves a symlinked directory to its real path', async () => {
    await ws.write('docs/a.md', 'x\n');
    const link = path.join(ws.home, 'linked');
    await fs.symlink(path.join(ws.root, 'docs'), link);
    expect(await assertReadableDir(link)).toBe(path.join(ws.root, 'docs'));
  });

  it('changes the root and keeps the old one when the new one is unreadable', async () => {
    await ws.write('docs/a.md', 'x\n');
    const docs = path.join(ws.root, 'docs');
    const session = await json<SessionInfo>('POST', '/api/root', { path: docs });
    expect(session.root).toBe(docs);
    const failed = await call('POST', '/api/root', { path: path.join(ws.root, 'missing') });
    expect(failed.status).toBe(400);
    expect((await json<SessionInfo>('GET', '/api/session')).root).toBe(docs);
  });
});

describe('static files', () => {
  it('serves the built frontend, falls back to index.html and stays inside the web directory', async () => {
    const webDir = path.join(ws.home, 'web');
    await fs.mkdir(path.join(webDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>DocsReview</title>');
    await fs.writeFile(path.join(webDir, 'assets/app.js'), 'console.log(1)');
    await fs.writeFile(path.join(ws.home, 'secret.txt'), 'secret');
    ctx.webDir = webDir;

    const index = await app.request(`${ORIGIN}/?token=${TOKEN}`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await index.text()).toContain('DocsReview');

    const script = await app.request(`${ORIGIN}/assets/app.js`);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await script.text()).toBe('console.log(1)');

    const escape = await app.request(`${ORIGIN}/..%2Fsecret.txt`);
    expect(await escape.text()).toContain('DocsReview');
  });
});
