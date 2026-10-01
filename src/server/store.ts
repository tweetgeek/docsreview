import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ReviewState } from '../core/types.js';
import { isNotFound } from './errors.js';

const MAX_RECENT = 10;
const warnings = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();

export function homeDir(): string {
  return process.env.DOCSREVIEW_HOME ?? path.join(os.homedir(), '.docsreview');
}

export function reviewDir(root: string): string {
  const name = path.basename(root).replace(/[^A-Za-z0-9._-]/g, '_') || 'root';
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 12);
  return path.join(homeDir(), 'reviews', `${name}-${hash}`);
}

export function stateFile(root: string): string {
  return path.join(reviewDir(root), 'state.json');
}

function recentFile(): string {
  return path.join(homeDir(), 'recent.json');
}

export function emptyState(root: string): ReviewState {
  return { version: 1, root, showIgnored: false, handoff: null, comments: [] };
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, data, 'utf8');
  await fs.rename(temporary, file);
}

function isValidState(value: unknown): value is ReviewState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    state.version === 1 &&
    typeof state.showIgnored === 'boolean' &&
    Array.isArray(state.comments) &&
    (state.handoff === null || typeof state.handoff === 'object')
  );
}

export async function loadState(root: string): Promise<ReviewState> {
  const file = stateFile(root);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return emptyState(root);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }
  if (isValidState(parsed)) return parsed;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const broken = `${file}.broken-${stamp}`;
  try {
    await fs.rename(file, broken);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  warnings.set(
    root,
    `Plik stanu był uszkodzony i został odłożony jako ${path.basename(broken)}. Review zaczyna od pustego stanu.`,
  );
  return emptyState(root);
}

export function getWarning(root: string): string | null {
  return warnings.get(root) ?? null;
}

export async function saveState(state: ReviewState): Promise<void> {
  await writeAtomic(stateFile(state.root), `${JSON.stringify(state, null, 2)}\n`);
}

export function updateState(
  root: string,
  mutate: (state: ReviewState) => ReviewState | Promise<ReviewState>,
): Promise<ReviewState> {
  const previous = queues.get(root) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const state = await mutate(await loadState(root));
      await saveState(state);
      return state;
    });
  queues.set(root, next);
  return next;
}

export async function loadRecent(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(recentFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function touchRecent(root: string): Promise<void> {
  const others = (await loadRecent()).filter((item) => item !== root);
  const recent = [root, ...others].slice(0, MAX_RECENT);
  await writeAtomic(recentFile(), `${JSON.stringify(recent, null, 2)}\n`);
}
