import { mkdirSync } from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { EventHub } from './events.js';
import { isAlwaysSkipped } from './ignore.js';
import { isMarkdown } from './scanner.js';
import { homeDir, reviewDir } from './store.js';

const DEBOUNCE_MS = 100;

export interface RootWatcher {
  ready: Promise<void>;
  close(): Promise<void>;
}

export function watchRoot(root: string, hub: EventHub): RootWatcher {
  const home = homeDir();
  const pending = new Set<string>();
  let filesTimer: NodeJS.Timeout | null = null;
  let stateTimer: NodeJS.Timeout | null = null;

  const files = chokidar.watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    ignored: (target, stats) => {
      if (target === home || target.startsWith(home + path.sep)) return true;
      if (path.relative(root, target).split(path.sep).some(isAlwaysSkipped)) return true;
      if (stats?.isFile()) return !isMarkdown(target) && path.basename(target) !== '.gitignore';
      return false;
    },
  });
  files.on('all', (event, target) => {
    if (event === 'addDir' || event === 'unlinkDir') return;
    pending.add(path.relative(root, target).split(path.sep).join('/'));
    filesTimer ??= setTimeout(() => {
      filesTimer = null;
      const paths = [...pending].sort();
      pending.clear();
      hub.emit({ type: 'files-changed', paths });
    }, DEBOUNCE_MS);
  });

  const stateDir = reviewDir(root);
  mkdirSync(stateDir, { recursive: true });
  const state = chokidar.watch(stateDir, { ignoreInitial: true, depth: 0 });
  state.on('all', (_event, target) => {
    if (path.basename(target) !== 'state.json') return;
    stateTimer ??= setTimeout(() => {
      stateTimer = null;
      hub.emit({ type: 'review-changed' });
    }, DEBOUNCE_MS);
  });

  const ready = Promise.all([
    new Promise<void>((resolve) => files.once('ready', () => resolve())),
    new Promise<void>((resolve) => state.once('ready', () => resolve())),
  ]).then(() => undefined);

  return {
    ready,
    async close() {
      if (filesTimer !== null) clearTimeout(filesTimer);
      if (stateTimer !== null) clearTimeout(stateTimer);
      await Promise.all([files.close(), state.close()]);
    },
  };
}
