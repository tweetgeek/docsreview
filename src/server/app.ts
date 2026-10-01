import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ServerEvent } from '../core/types.js';
import { HttpError } from './errors.js';
import type { EventHub } from './events.js';
import { listDirs } from './files.js';
import {
  addComment,
  deleteComment,
  deleteResolved,
  getFileView,
  getSession,
  handoff,
  listComments,
  listFiles,
  patchComment,
  setShowIgnored,
} from './review.js';
import { isAllowedUrl, tokenMatches } from './security.js';

export interface AppContext {
  token: string;
  port: number;
  webDir: string | null;
  hub: EventHub;
  getRoot(): string;
  setRoot(dir: string): Promise<void>;
}

const PING_INTERVAL_MS = 15_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await c.req.json();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through to the error below
  }
  throw new HttpError(400, 'Nieprawidłowe dane żądania');
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  const changed = (): void => ctx.hub.emit({ type: 'review-changed' });

  app.onError((error, c) => {
    if (error instanceof HttpError) {
      return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    }
    console.error(error);
    return c.json({ error: 'Błąd serwera' }, 500);
  });

  app.use('/api/*', async (c, next) => {
    if (!isAllowedUrl(c.req.url, ctx.port)) return c.json({ error: 'Niedozwolony host' }, 403);
    const header = c.req.header('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const provided = c.req.path === '/api/events' ? c.req.query('token') : bearer;
    if (!tokenMatches(provided, ctx.token)) return c.json({ error: 'Brak autoryzacji' }, 401);
    await next();
  });

  app.get('/api/session', async (c) => c.json(await getSession(ctx.getRoot())));

  app.post('/api/root', async (c) => {
    const body = await readBody(c);
    if (typeof body.path !== 'string' || body.path === '') throw new HttpError(400, 'Brak ścieżki katalogu');
    await ctx.setRoot(body.path);
    return c.json(await getSession(ctx.getRoot()));
  });

  app.get('/api/dirs', async (c) => c.json(await listDirs(c.req.query('path'))));

  app.patch('/api/review', async (c) => {
    const body = await readBody(c);
    await setShowIgnored(ctx.getRoot(), body.showIgnored);
    changed();
    return c.json({ ok: true });
  });

  app.get('/api/files', async (c) => c.json(await listFiles(ctx.getRoot())));

  app.get('/api/file', async (c) => c.json(await getFileView(ctx.getRoot(), c.req.query('path'))));

  app.get('/api/comments', async (c) => c.json(await listComments(ctx.getRoot())));

  app.post('/api/comments', async (c) => {
    const id = await addComment(ctx.getRoot(), await readBody(c));
    changed();
    return c.json({ id }, 201);
  });

  app.patch('/api/comments/:id', async (c) => {
    await patchComment(ctx.getRoot(), c.req.param('id'), await readBody(c));
    changed();
    return c.json({ ok: true });
  });

  app.delete('/api/comments/:id', async (c) => {
    await deleteComment(ctx.getRoot(), c.req.param('id'));
    changed();
    return c.json({ ok: true });
  });

  app.delete('/api/comments', async (c) => {
    if (c.req.query('status') !== 'resolved') throw new HttpError(400, 'Można usunąć tylko rozwiązane komentarze');
    await deleteResolved(ctx.getRoot());
    changed();
    return c.json({ ok: true });
  });

  app.post('/api/handoff', async (c) => {
    await handoff(ctx.getRoot());
    changed();
    return c.json({ ok: true });
  });

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: ServerEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = ctx.hub.subscribe((event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      while (!stream.aborted) {
        while (queue.length > 0) {
          const event = queue.shift()!;
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
        }
        let timer: NodeJS.Timeout | undefined;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, PING_INTERVAL_MS);
        });
        clearTimeout(timer);
        wake = null;
        if (!stream.aborted && queue.length === 0) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      unsubscribe();
    }),
  );

  app.all('/api/*', (c) => c.json({ error: 'Nie znaleziono' }, 404));

  app.get('*', async (c) => {
    const webDir = ctx.webDir;
    if (webDir === null) return c.notFound();
    const index = path.join(webDir, 'index.html');
    let requested: string;
    try {
      requested = decodeURIComponent(c.req.path);
    } catch {
      requested = '/';
    }
    const candidate = path.join(webDir, requested);
    const inside = candidate.startsWith(webDir + path.sep);
    let file = inside && requested !== '/' ? candidate : index;
    let data: Buffer;
    try {
      data = await fs.readFile(file);
    } catch {
      file = index;
      try {
        data = await fs.readFile(file);
      } catch {
        return c.notFound();
      }
    }
    const type = MIME[path.extname(file)] ?? 'application/octet-stream';
    return c.body(new Uint8Array(data), 200, { 'content-type': type, 'cache-control': 'no-cache' });
  });

  return app;
}
