import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp, type AppContext } from './app.js';
import { errorCode } from './errors.js';
import { EventHub } from './events.js';
import { assertReadableDir } from './files.js';
import { createToken } from './security.js';
import { touchRecent } from './store.js';
import { watchRoot } from './watcher.js';

const PORT_ATTEMPTS = 50;

export interface StartOptions {
  root: string;
  port: number;
  webDir: string | null;
  token?: string;
}

export interface RunningServer {
  root: string;
  port: number;
  token: string;
  url: string;
  ready: Promise<void>;
  close(): Promise<void>;
}

function tryListen(app: Hono, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }) as Server;
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

async function listen(app: Hono, port: number): Promise<Server> {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    try {
      return await tryListen(app, port === 0 ? 0 : port + attempt);
    } catch (error) {
      if (errorCode(error) !== 'EADDRINUSE' || port === 0) throw error;
    }
  }
  throw new Error(`Nie znaleziono wolnego portu w zakresie ${port}-${port + PORT_ATTEMPTS - 1}`);
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  let root = await assertReadableDir(options.root);
  const hub = new EventHub();
  let watcher = watchRoot(root, hub);
  await touchRecent(root);

  const ctx: AppContext = {
    token: options.token ?? createToken(),
    port: options.port,
    webDir: options.webDir,
    hub,
    getRoot: () => root,
    setRoot: async (dir) => {
      const next = await assertReadableDir(dir);
      if (next !== root) {
        await watcher.close();
        root = next;
        watcher = watchRoot(root, hub);
      }
      await touchRecent(root);
      hub.emit({ type: 'review-changed' });
    },
  };
  const server = await listen(createApp(ctx), options.port);
  ctx.port = (server.address() as AddressInfo).port;

  return {
    root,
    port: ctx.port,
    token: ctx.token,
    url: `http://127.0.0.1:${ctx.port}/?token=${ctx.token}`,
    ready: watcher.ready,
    async close() {
      await watcher.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
