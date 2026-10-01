import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommentsResponse, FileView, ServerEvent } from '../../src/core/types.js';
import { DEFAULT_PORT, parseCliArgs } from '../../src/server/args.js';
import { EventHub } from '../../src/server/events.js';
import { startServer, type RunningServer } from '../../src/server/start.js';
import { loadRecent, stateFile } from '../../src/server/store.js';
import { watchRoot } from '../../src/server/watcher.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;
const running: RunningServer[] = [];

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
  await ws.cleanup();
});

async function start(port = 0): Promise<RunningServer> {
  const server = await startServer({ root: ws.root, port, webDir: null, token: 'tok' });
  running.push(server);
  await server.ready;
  return server;
}

async function api<T>(server: RunningServer, method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${server.port}${url}`, {
    method,
    headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.status).toBeLessThan(300);
  return (await response.json()) as T;
}

function waitFor(events: ServerEvent[], match: (event: ServerEvent) => boolean): Promise<ServerEvent> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = events.find(match);
      if (found !== undefined) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - started > 5000) {
        clearInterval(timer);
        reject(new Error(`no matching event; got ${JSON.stringify(events)}`));
      }
    }, 20);
  });
}

describe('parseCliArgs', () => {
  it('defaults to the current directory, the default port and opening the browser', () => {
    expect(parseCliArgs([])).toEqual({ root: process.cwd(), port: DEFAULT_PORT, open: true, help: false });
  });

  it('reads the directory, the port and --no-open', () => {
    expect(parseCliArgs(['docs', '--port', '5000', '--no-open'])).toEqual({
      root: 'docs',
      port: 5000,
      open: false,
      help: false,
    });
  });

  it('rejects a port that is not a number in range, unknown options and extra directories', () => {
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow('Nieprawidłowy port: abc');
    expect(() => parseCliArgs(['--port', '70000'])).toThrow('Nieprawidłowy port');
    expect(() => parseCliArgs(['--frobnicate'])).toThrow();
    expect(() => parseCliArgs(['a', 'b'])).toThrow('Podaj najwyżej jeden katalog');
  });
});

describe('startServer', () => {
  it('fails with a readable message for a directory that does not exist', async () => {
    await expect(
      startServer({ root: path.join(ws.root, 'missing'), port: 0, webDir: null }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Katalog nie istnieje') });
  });

  it('serves the API on 127.0.0.1 with the token in the URL and remembers the directory', async () => {
    const server = await start();
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/?token=tok`);
    expect(await api<{ root: string }>(server, 'GET', '/api/session')).toMatchObject({ root: ws.root });
    expect(await loadRecent()).toEqual([ws.root]);
  });

  it('takes the next free port when the requested one is busy', async () => {
    const first = await start();
    const second = await start(first.port);
    expect(second.port).toBeGreaterThan(first.port);
    expect(second.port).toBeLessThan(first.port + 50);
  });

  it('rejects a request with a foreign Host header', async () => {
    const server = await start();
    const status = await new Promise<number>((resolve, reject) => {
      http
        .get(
          {
            host: '127.0.0.1',
            port: server.port,
            path: '/api/session',
            headers: { Host: `evil.example:${server.port}`, authorization: 'Bearer tok' },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        )
        .on('error', reject);
    });
    expect(status).toBe(403);
  });

  it('shares comments between two instances on the same directory', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    const first = await start();
    const second = await start();
    const view = await api<FileView>(first, 'GET', '/api/file?path=a.md');
    await api(first, 'POST', '/api/comments', { file: 'a.md', line: 1, text: 'z pierwszej', contentHash: view.contentHash });
    await api(second, 'POST', '/api/comments', { file: 'a.md', line: 2, text: 'z drugiej', contentHash: view.contentHash });
    for (const server of [first, second]) {
      const { comments } = await api<CommentsResponse>(server, 'GET', '/api/comments');
      expect(comments.map((comment) => comment.text)).toEqual(['z pierwszej', 'z drugiej']);
    }
  });

  it('streams a files-changed event when a markdown file changes on disk', async () => {
    await ws.write('a.md', 'one\n');
    const server = await start();
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}/api/events?token=tok`, {
      signal: controller.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = decoder.decode((await reader.read()).value);
    expect(received).toContain('event: ready');

    await ws.write('a.md', 'two\n');
    while (!received.includes('event: files-changed')) {
      received += decoder.decode((await reader.read()).value);
    }
    expect(received).toContain('"paths":["a.md"]');
    controller.abort();
  });
});

describe('watchRoot', () => {
  it('groups changes into one event and reports only markdown and .gitignore files', async () => {
    await ws.write('docs/a.md', 'one\n');
    await ws.write('node_modules/pkg/README.md', 'x\n');
    const hub = new EventHub();
    const events: ServerEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const watcher = watchRoot(ws.root, hub);
    await watcher.ready;
    try {
      await ws.write('docs/a.md', 'two\n');
      await ws.write('docs/new.md', 'new\n');
      await ws.write('.gitignore', 'x\n');
      await ws.write('notes.txt', 'x\n');
      await ws.write('node_modules/pkg/README.md', 'y\n');
      await waitFor(events, (event) => event.type === 'files-changed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const changed = events.filter((event) => event.type === 'files-changed');
      expect(changed).toEqual([{ type: 'files-changed', paths: ['.gitignore', 'docs/a.md', 'docs/new.md'] }]);
    } finally {
      await watcher.close();
    }
  });

  it('reports a deleted file', async () => {
    await ws.write('a.md', 'one\n');
    const hub = new EventHub();
    const events: ServerEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const watcher = watchRoot(ws.root, hub);
    await watcher.ready;
    try {
      await ws.remove('a.md');
      const event = await waitFor(events, (candidate) => candidate.type === 'files-changed');
      expect(event).toEqual({ type: 'files-changed', paths: ['a.md'] });
    } finally {
      await watcher.close();
    }
  });

  it('reports a review change when another instance rewrites the state file', async () => {
    const hub = new EventHub();
    const events: ServerEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const watcher = watchRoot(ws.root, hub);
    await watcher.ready;
    try {
      const temporary = `${stateFile(ws.root)}.other.tmp`;
      await fs.writeFile(temporary, '{}');
      await fs.rename(temporary, stateFile(ws.root));
      await waitFor(events, (event) => event.type === 'review-changed');
    } finally {
      await watcher.close();
    }
  });
});
