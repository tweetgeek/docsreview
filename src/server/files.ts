import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { splitLines } from '../core/lines.js';
import type { DirListing } from '../core/types.js';
import { HttpError, isNotFound } from './errors.js';
import { isMarkdown } from './scanner.js';
import { hashContent } from './snapshots.js';

export const MAX_RENDER_BYTES = 1024 * 1024;

export interface DiskFile {
  content: string;
  hash: string;
  lines: string[];
  bytes: number;
}

export function normalizeRelPath(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new HttpError(400, 'Brak ścieżki pliku');
  const normalized = path.posix.normalize(value);
  const escapes = normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/');
  if (escapes || !isMarkdown(normalized)) throw new HttpError(403, 'Niedozwolona ścieżka');
  return normalized;
}

export async function readDiskFile(root: string, relPath: string): Promise<DiskFile | null> {
  let realRoot: string;
  let realFile: string;
  try {
    realRoot = await fs.realpath(root);
    realFile = await fs.realpath(path.join(root, relPath));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  if (!realFile.startsWith(realRoot + path.sep) || !isMarkdown(realFile)) {
    throw new HttpError(403, 'Niedozwolona ścieżka');
  }
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(realFile);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  const content = buffer.toString('utf8');
  return { content, hash: hashContent(content), lines: splitLines(content), bytes: buffer.byteLength };
}

export async function assertReadableDir(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  try {
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) throw new Error('not a directory');
    await fs.readdir(resolved);
  } catch {
    throw new HttpError(400, `Katalog nie istnieje lub nie można go odczytać: ${resolved}`);
  }
  return resolved;
}

export async function listDirs(target: string | undefined): Promise<DirListing> {
  const dir = await assertReadableDir(target === undefined || target === '' ? os.homedir() : target);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, dirs };
}
