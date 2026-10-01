import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectGarbage, hashContent, readSnapshot, saveSnapshot } from '../../src/server/snapshots.js';
import {
  emptyState,
  getWarning,
  loadRecent,
  loadState,
  reviewDir,
  saveState,
  stateFile,
  touchRecent,
  updateState,
} from '../../src/server/store.js';
import { makeComment } from '../helpers/factories.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await ws.cleanup();
});

describe('review directory', () => {
  it('lives under the DocsReview home and is named after the root', () => {
    const dir = reviewDir('/Users/x/Projects/my agent');
    expect(path.dirname(dir)).toBe(path.join(ws.home, 'reviews'));
    expect(path.basename(dir)).toMatch(/^my_agent-[0-9a-f]{12}$/);
  });

  it('differs for two roots with the same directory name', () => {
    expect(reviewDir('/a/docs')).not.toBe(reviewDir('/b/docs'));
  });
});

describe('state', () => {
  it('starts empty when nothing was saved', async () => {
    expect(await loadState(ws.root)).toEqual(emptyState(ws.root));
  });

  it('round-trips through disk', async () => {
    const state = { ...emptyState(ws.root), showIgnored: true, comments: [makeComment()] };
    await saveState(state);
    expect(await loadState(ws.root)).toEqual(state);
  });

  it('leaves no temporary files behind', async () => {
    await saveState(emptyState(ws.root));
    expect(await fs.readdir(reviewDir(ws.root))).toEqual(['state.json']);
  });

  it('sets a corrupt state file aside and starts empty with a warning', async () => {
    await fs.mkdir(reviewDir(ws.root), { recursive: true });
    await fs.writeFile(stateFile(ws.root), '{ not json');
    expect(await loadState(ws.root)).toEqual(emptyState(ws.root));
    const names = await fs.readdir(reviewDir(ws.root));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^state\.json\.broken-/);
    expect(await fs.readFile(path.join(reviewDir(ws.root), names[0]!), 'utf8')).toBe('{ not json');
    expect(getWarning(ws.root)).toContain('state.json.broken-');
  });

  it('treats an unknown version as corrupt', async () => {
    await fs.mkdir(reviewDir(ws.root), { recursive: true });
    await fs.writeFile(stateFile(ws.root), JSON.stringify({ ...emptyState(ws.root), version: 2 }));
    expect(await loadState(ws.root)).toEqual(emptyState(ws.root));
    expect((await fs.readdir(reviewDir(ws.root)))[0]).toMatch(/^state\.json\.broken-/);
  });

  it('applies concurrent updates one after another without losing any', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((id) =>
        updateState(ws.root, (state) => ({ ...state, comments: [...state.comments, makeComment({ id })] })),
      ),
    );
    const ids = (await loadState(ws.root)).comments.map((comment) => comment.id);
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps working after an update that throws', async () => {
    await expect(
      updateState(ws.root, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await updateState(ws.root, (state) => ({ ...state, showIgnored: true }));
    expect((await loadState(ws.root)).showIgnored).toBe(true);
  });

  it('picks up a change written to disk by another instance', async () => {
    await updateState(ws.root, (state) => ({ ...state, comments: [makeComment({ id: 'mine' })] }));
    const onDisk = JSON.parse(await fs.readFile(stateFile(ws.root), 'utf8'));
    onDisk.comments.push(makeComment({ id: 'theirs' }));
    await fs.writeFile(stateFile(ws.root), JSON.stringify(onDisk));
    await updateState(ws.root, (state) => ({ ...state, comments: [...state.comments, makeComment({ id: 'mine-2' })] }));
    const ids = (await loadState(ws.root)).comments.map((comment) => comment.id);
    expect(ids).toEqual(['mine', 'theirs', 'mine-2']);
  });
});

describe('recent directories', () => {
  it('is empty at first', async () => {
    expect(await loadRecent()).toEqual([]);
  });

  it('puts the latest directory first without duplicates', async () => {
    await touchRecent('/a');
    await touchRecent('/b');
    await touchRecent('/a');
    expect(await loadRecent()).toEqual(['/a', '/b']);
  });

  it('keeps at most ten directories', async () => {
    for (let index = 0; index < 12; index++) await touchRecent(`/dir-${index}`);
    const recent = await loadRecent();
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe('/dir-11');
  });
});

describe('snapshots', () => {
  it('stores content under its hash and reads it back', async () => {
    const hash = await saveSnapshot(ws.root, 'linia\n');
    expect(hash).toBe(hashContent('linia\n'));
    expect(await readSnapshot(ws.root, hash)).toBe('linia\n');
  });

  it('returns null for a missing or malformed hash', async () => {
    expect(await readSnapshot(ws.root, hashContent('nope'))).toBeNull();
    expect(await readSnapshot(ws.root, '../state')).toBeNull();
  });

  it('deletes snapshots that neither a comment nor the handoff refers to', async () => {
    const byComment = await saveSnapshot(ws.root, 'comment\n');
    const byHandoff = await saveSnapshot(ws.root, 'handoff\n');
    const unused = await saveSnapshot(ws.root, 'unused\n');
    await collectGarbage(ws.root, {
      ...emptyState(ws.root),
      comments: [makeComment({ anchor: { snapshot: byComment, line: 1, lineText: 'comment' } })],
      handoff: { at: '2026-10-01T12:00:00.000Z', showIgnored: false, files: { 'a.md': byHandoff } },
    });
    expect(await readSnapshot(ws.root, byComment)).toBe('comment\n');
    expect(await readSnapshot(ws.root, byHandoff)).toBe('handoff\n');
    expect(await readSnapshot(ws.root, unused)).toBeNull();
  });
});
