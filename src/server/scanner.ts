import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ancestorLayers, extendLayers, isAlwaysSkipped, isIgnoredBy, type IgnoreLayer } from './ignore.js';
import { homeDir } from './store.js';

export interface ScannedFile {
  path: string;
  ignored: boolean;
}

export interface ScanOptions {
  showIgnored: boolean;
  alwaysInclude: string[];
}

export function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

async function isRegularFile(target: string): Promise<boolean> {
  try {
    return (await fs.lstat(target)).isFile();
  } catch {
    return false;
  }
}

async function walk(
  root: string,
  dir: string,
  layers: IgnoreLayer[],
  parentIgnored: boolean,
  showIgnored: boolean,
  found: Map<string, ScannedFile>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isAlwaysSkipped(entry.name) || absolute === homeDir()) continue;
      const ignored = parentIgnored || isIgnoredBy(layers, absolute, true);
      if (ignored && !showIgnored) continue;
      await walk(root, absolute, await extendLayers(layers, absolute), ignored, showIgnored, found);
    } else if (entry.isFile() && isMarkdown(entry.name)) {
      const ignored = parentIgnored || isIgnoredBy(layers, absolute, false);
      if (ignored && !showIgnored) continue;
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      found.set(relative, { path: relative, ignored });
    }
  }
}

export async function scanFiles(root: string, options: ScanOptions): Promise<ScannedFile[]> {
  const found = new Map<string, ScannedFile>();
  const ancestors = await ancestorLayers(root);
  const rootIgnored = isIgnoredBy(ancestors, root, true);
  if (!rootIgnored || options.showIgnored) {
    await walk(root, root, await extendLayers(ancestors, root), rootIgnored, options.showIgnored, found);
  }
  for (const relative of options.alwaysInclude) {
    if (found.has(relative)) continue;
    if (await isRegularFile(path.join(root, relative))) found.set(relative, { path: relative, ignored: true });
  }
  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
