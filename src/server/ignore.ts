import fs from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface IgnoreLayer {
  dir: string;
  rules: Ignore;
}

const ALWAYS_SKIPPED = new Set(['.git', 'node_modules']);

export function isAlwaysSkipped(name: string): boolean {
  return ALWAYS_SKIPPED.has(name);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function readLayer(dir: string): Promise<IgnoreLayer | null> {
  try {
    const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    return { dir, rules: ignore().add(content) };
  } catch {
    return null;
  }
}

export async function extendLayers(layers: IgnoreLayer[], dir: string): Promise<IgnoreLayer[]> {
  const layer = await readLayer(dir);
  return layer === null ? layers : [...layers, layer];
}

export async function ancestorLayers(root: string): Promise<IgnoreLayer[]> {
  let repoRoot: string | null = null;
  let dir = root;
  for (;;) {
    if (await exists(path.join(dir, '.git'))) {
      repoRoot = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (repoRoot === null || repoRoot === root) return [];

  const dirs: string[] = [];
  let current = path.dirname(root);
  for (;;) {
    dirs.unshift(current);
    if (current === repoRoot) break;
    current = path.dirname(current);
  }
  let layers: IgnoreLayer[] = [];
  for (const ancestor of dirs) layers = await extendLayers(layers, ancestor);
  return layers;
}

export function isIgnoredBy(layers: IgnoreLayer[], absPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const layer of layers) {
    const relative = path.relative(layer.dir, absPath).split(path.sep).join('/');
    if (relative === '' || relative.startsWith('..')) continue;
    const result = layer.rules.test(isDir ? `${relative}/` : relative);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

export async function isPathIgnored(root: string, relPath: string): Promise<boolean> {
  let layers = await ancestorLayers(root);
  if (isIgnoredBy(layers, root, true)) return true;
  layers = await extendLayers(layers, root);
  const parts = relPath.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]!);
    const isDir = index < parts.length - 1;
    if (isIgnoredBy(layers, current, isDir)) return true;
    if (isDir) layers = await extendLayers(layers, current);
  }
  return false;
}
