import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReviewState } from '../core/types.js';
import { isNotFound } from './errors.js';
import { reviewDir } from './store.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function snapshotDir(root: string): string {
  return path.join(reviewDir(root), 'snapshots');
}

export async function saveSnapshot(root: string, content: string): Promise<string> {
  const hash = hashContent(content);
  const file = path.join(snapshotDir(root), `${hash}.md`);
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(snapshotDir(root), { recursive: true });
    await fs.writeFile(file, content, 'utf8');
  }
  return hash;
}

export async function readSnapshot(root: string, hash: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  try {
    return await fs.readFile(path.join(snapshotDir(root), `${hash}.md`), 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function collectGarbage(root: string, state: ReviewState): Promise<void> {
  const used = new Set<string>();
  for (const comment of state.comments) used.add(comment.anchor.snapshot);
  if (state.handoff !== null) {
    for (const hash of Object.values(state.handoff.files)) used.add(hash);
  }
  let names: string[];
  try {
    names = await fs.readdir(snapshotDir(root));
  } catch {
    return;
  }
  const unused = names.filter((name) => name.endsWith('.md') && !used.has(name.slice(0, -3)));
  await Promise.all(unused.map((name) => fs.rm(path.join(snapshotDir(root), name), { force: true })));
}
