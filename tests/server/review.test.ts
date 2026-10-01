import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
} from '../../src/server/review.js';
import { reviewDir } from '../../src/server/store.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await ws.cleanup();
});

async function comment(file: string, line: number, text: string): Promise<string> {
  const view = await getFileView(ws.root, file);
  return addComment(ws.root, { file, line, text, contentHash: view.contentHash });
}

async function snapshotCount(): Promise<number> {
  try {
    return (await fs.readdir(path.join(reviewDir(ws.root), 'snapshots'))).length;
  } catch {
    return 0;
  }
}

describe('file view', () => {
  it('returns content, hash and no round information before the first handoff', async () => {
    await ws.write('docs/a.md', 'one\ntwo\n');
    const view = await getFileView(ws.root, 'docs/a.md');
    expect(view).toMatchObject({
      path: 'docs/a.md',
      content: 'one\ntwo\n',
      tooLarge: false,
      roundStatus: 'unchanged',
      changedLines: [],
      comments: [],
    });
    expect(view.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('flags files larger than 1 MB', async () => {
    await ws.write('big.md', 'x'.repeat(1024 * 1024 + 1));
    expect((await getFileView(ws.root, 'big.md')).tooLarge).toBe(true);
  });

  it('answers 404 for a file that does not exist', async () => {
    await expect(getFileView(ws.root, 'missing.md')).rejects.toMatchObject({ status: 404 });
  });

  it('answers 403 for paths outside the root and for files that are not markdown', async () => {
    await ws.write('secret.txt', 'x\n');
    await fs.writeFile(path.join(ws.root, '..', 'outside.md'), 'x\n');
    await expect(getFileView(ws.root, '../outside.md')).rejects.toMatchObject({ status: 403 });
    await expect(getFileView(ws.root, '/etc/hosts.md')).rejects.toMatchObject({ status: 403 });
    await expect(getFileView(ws.root, 'docs/../../outside.md')).rejects.toMatchObject({ status: 403 });
    await expect(getFileView(ws.root, 'secret.txt')).rejects.toMatchObject({ status: 403 });
  });

  it('answers 403 for a markdown symlink that points outside the root', async () => {
    await fs.writeFile(path.join(ws.root, '..', 'outside.md'), 'x\n');
    await fs.symlink(path.join(ws.root, '..', 'outside.md'), path.join(ws.root, 'link.md'));
    await expect(getFileView(ws.root, 'link.md')).rejects.toMatchObject({ status: 403 });
  });

  it('reads a file whose name has spaces, Polish letters and a hash sign', async () => {
    await ws.write('docs/Plan wdrożenia #2.md', 'treść\n');
    await comment('docs/Plan wdrożenia #2.md', 1, 'ok');
    const { output } = await listComments(ws.root);
    expect(output).toBe('### docs/Plan wdrożenia #2.md:1 > ok');
  });
});

describe('adding comments', () => {
  it('stores the comment with an anchor to the commented line', async () => {
    await ws.write('a.md', 'one\ntwo\nthree\n');
    await comment('a.md', 2, '  popraw to  ');
    const [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({
      file: 'a.md',
      text: 'popraw to',
      status: 'open',
      currentLine: 2,
      lineChanged: false,
      previousLineText: 'two',
      handedOff: false,
      needsCheck: false,
    });
  });

  it('answers 409 when the file changed after it was displayed', async () => {
    await ws.write('a.md', 'one\n');
    const view = await getFileView(ws.root, 'a.md');
    await ws.write('a.md', 'changed\n');
    await expect(
      addComment(ws.root, { file: 'a.md', line: 1, text: 'x', contentHash: view.contentHash }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await listComments(ws.root)).comments).toEqual([]);
  });

  it('answers 404 when the file was deleted after it was displayed', async () => {
    await ws.write('a.md', 'one\n');
    const view = await getFileView(ws.root, 'a.md');
    await ws.remove('a.md');
    await expect(
      addComment(ws.root, { file: 'a.md', line: 1, text: 'x', contentHash: view.contentHash }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('answers 400 for an empty comment and for a line outside the file', async () => {
    await ws.write('a.md', 'one\n');
    const { contentHash } = await getFileView(ws.root, 'a.md');
    await expect(addComment(ws.root, { file: 'a.md', line: 1, text: '   \n', contentHash })).rejects.toMatchObject({
      status: 400,
    });
    for (const line of [0, 2, 1.5, '1']) {
      await expect(addComment(ws.root, { file: 'a.md', line, text: 'x', contentHash })).rejects.toMatchObject({
        status: 400,
      });
    }
  });
});

describe('changing comments', () => {
  it('resolves and reopens', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    await patchComment(ws.root, id, { status: 'resolved' });
    let [view] = (await listComments(ws.root)).comments;
    expect(view!.status).toBe('resolved');
    expect(view!.resolvedAt).not.toBeNull();
    await patchComment(ws.root, id, { status: 'open' });
    [view] = (await listComments(ws.root)).comments;
    expect(view).toMatchObject({ status: 'open', resolvedAt: null });
  });

  it('edits the text', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    await patchComment(ws.root, id, { text: ' nowa treść ' });
    expect((await listComments(ws.root)).comments[0]!.text).toBe('nowa treść');
  });

  it('answers 400 for an empty text or unknown status and 404 for an unknown comment', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    await expect(patchComment(ws.root, id, { text: ' ' })).rejects.toMatchObject({ status: 400 });
    await expect(patchComment(ws.root, id, { status: 'done' })).rejects.toMatchObject({ status: 400 });
    await expect(patchComment(ws.root, 'nope', { status: 'resolved' })).rejects.toMatchObject({ status: 404 });
    await expect(deleteComment(ws.root, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('deletes one comment and cleans up its snapshot', async () => {
    await ws.write('a.md', 'one\n');
    const id = await comment('a.md', 1, 'x');
    expect(await snapshotCount()).toBe(1);
    await deleteComment(ws.root, id);
    expect((await listComments(ws.root)).comments).toEqual([]);
    expect(await snapshotCount()).toBe(0);
  });

  it('deletes all resolved comments and keeps the open ones', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    const first = await comment('a.md', 1, 'pierwszy');
    await comment('a.md', 2, 'drugi');
    await patchComment(ws.root, first, { status: 'resolved' });
    await deleteResolved(ws.root);
    expect((await listComments(ws.root)).comments.map((view) => view.text)).toEqual(['drugi']);
  });
});

describe('output and missing files', () => {
  it('lists open comments of existing files in the output', async () => {
    await ws.write('b.md', 'one\n');
    await ws.write('a.md', 'one\ntwo\n');
    await comment('b.md', 1, 'w b');
    await comment('a.md', 2, 'w a');
    expect((await listComments(ws.root)).output).toBe('### a.md:2 > w a\n\n### b.md:1 > w b');
  });

  it('keeps comments of a deleted file, flags them and leaves them out of the output', async () => {
    await ws.write('a.md', 'one\n');
    await comment('a.md', 1, 'x');
    await ws.remove('a.md');
    const { comments, output } = await listComments(ws.root);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ fileMissing: true, currentLine: 1 });
    expect(output).toBe('');
    expect(await listFiles(ws.root)).toEqual([]);
  });

  it('reactivates the comments when the file comes back', async () => {
    await ws.write('a.md', 'one\n');
    await comment('a.md', 1, 'x');
    await ws.remove('a.md');
    await ws.write('a.md', 'zero\none\n');
    const { comments, output } = await listComments(ws.root);
    expect(comments[0]).toMatchObject({ fileMissing: false, currentLine: 2 });
    expect(output).toBe('### a.md:2 > x');
  });
});

describe('a full round', () => {
  it('re-anchors on handoff and shows what the agent changed afterwards', async () => {
    await ws.write('a.md', 'intro\nUruchom `npm start`\noutro\n');
    await ws.write('b.md', 'untouched\n');
    await ws.write('c.md', 'will change\n');
    await comment('a.md', 2, 'podaj komendę npx');

    await handoff(ws.root);
    expect((await getSession(ws.root)).lastHandoffAt).not.toBeNull();
    let view = await getFileView(ws.root, 'a.md');
    expect(view.roundStatus).toBe('unchanged');
    expect(view.comments[0]).toMatchObject({ handedOff: true, lineChanged: false, needsCheck: false });

    await ws.write('a.md', 'new first line\nintro\nUruchom `npm exec docsreview`\noutro\n');
    await ws.write('c.md', 'did change\n');
    await ws.write('d.md', 'brand new\n');

    view = await getFileView(ws.root, 'a.md');
    expect(view.roundStatus).toBe('changed');
    expect(view.changedLines).toEqual([1, 3]);
    expect(view.comments[0]).toMatchObject({
      currentLine: 3,
      lineChanged: true,
      previousLineText: 'Uruchom `npm start`',
      handedOff: true,
      needsCheck: true,
    });
    expect(await listFiles(ws.root)).toEqual([
      { path: 'a.md', openComments: 1, ignored: false, roundStatus: 'changed' },
      { path: 'b.md', openComments: 0, ignored: false, roundStatus: 'unchanged' },
      { path: 'c.md', openComments: 0, ignored: false, roundStatus: 'changed' },
      { path: 'd.md', openComments: 0, ignored: false, roundStatus: 'new' },
    ]);
    expect((await getFileView(ws.root, 'c.md')).changedLines).toEqual([1]);
    expect((await getFileView(ws.root, 'd.md')).changedLines).toEqual([]);
    expect((await listComments(ws.root)).output).toBe('### a.md:3 > podaj komendę npx');
  });

  it('stops needing a check after an edit or a confirmation', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    await ws.write('b.md', 'one\ntwo\n');
    const edited = await comment('a.md', 2, 'x');
    const confirmed = await comment('b.md', 2, 'y');
    await handoff(ws.root);
    await ws.write('a.md', 'one\nTWO\n');
    await ws.write('b.md', 'one\nTWO\n');
    expect((await listComments(ws.root)).comments.map((view) => view.needsCheck)).toEqual([true, true]);
    await patchComment(ws.root, edited, { text: 'nadal źle' });
    await patchComment(ws.root, confirmed, { checked: true });
    expect((await listComments(ws.root)).comments.map((view) => view.needsCheck)).toEqual([false, false]);
  });

  it('shows the text from the previous handoff after a second handoff', async () => {
    await ws.write('a.md', 'Uruchom `npm start`\n');
    await comment('a.md', 1, 'podaj komendę npx');
    await handoff(ws.root);
    await ws.write('a.md', 'Uruchom `npm exec docsreview`\n');
    await handoff(ws.root);

    let [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({ lineChanged: false, needsCheck: false, previousLineText: 'Uruchom `npm exec docsreview`' });
    expect((await getFileView(ws.root, 'a.md')).changedLines).toEqual([]);

    await ws.write('a.md', 'Uruchom `npx docsreview`\n');
    [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({
      lineChanged: true,
      needsCheck: true,
      previousLineText: 'Uruchom `npm exec docsreview`',
    });
  });

  it('treats a comment added after the handoff as not handed off', async () => {
    await ws.write('a.md', 'one\ntwo\n');
    await comment('a.md', 1, 'stary');
    await handoff(ws.root);
    await comment('a.md', 2, 'nowy');
    const views = (await getFileView(ws.root, 'a.md')).comments;
    expect(views.map((view) => [view.text, view.handedOff])).toEqual([
      ['stary', true],
      ['nowy', false],
    ]);
  });

  it('answers 409 when there is nothing to hand off', async () => {
    await ws.write('a.md', 'one\n');
    await expect(handoff(ws.root)).rejects.toMatchObject({ status: 409 });
    const id = await comment('a.md', 1, 'x');
    await patchComment(ws.root, id, { status: 'resolved' });
    await expect(handoff(ws.root)).rejects.toMatchObject({ status: 409 });
    await patchComment(ws.root, id, { status: 'open' });
    await ws.remove('a.md');
    await expect(handoff(ws.root)).rejects.toMatchObject({ status: 409 });
    expect((await getSession(ws.root)).lastHandoffAt).toBeNull();
  });

  it('keeps only the snapshots that the new handoff and the comments need', async () => {
    await ws.write('a.md', 'v1\n');
    await ws.write('b.md', 'b\n');
    await comment('a.md', 1, 'x');
    await handoff(ws.root);
    expect(await snapshotCount()).toBe(2);
    await ws.write('a.md', 'v2\n');
    await handoff(ws.root);
    expect(await snapshotCount()).toBe(2);
  });

  it('falls back to the anchor line when a snapshot was deleted by hand', async () => {
    await ws.write('a.md', 'one\ntwo\nthree\n');
    await comment('a.md', 3, 'x');
    await fs.rm(path.join(reviewDir(ws.root), 'snapshots'), { recursive: true });
    await ws.write('a.md', 'one\ntwo\n');
    const [view] = (await getFileView(ws.root, 'a.md')).comments;
    expect(view).toMatchObject({ currentLine: 2, lineChanged: true });
  });
});

describe('ignored files', () => {
  it('hides ignored files until showIgnored is switched on', async () => {
    await ws.write('.gitignore', 'CLAUDE.local.md\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await ws.write('a.md', 'x\n');
    expect((await listFiles(ws.root)).map((file) => file.path)).toEqual(['a.md']);
    await setShowIgnored(ws.root, true);
    expect(await getSession(ws.root)).toMatchObject({ showIgnored: true });
    expect(await listFiles(ws.root)).toEqual([
      { path: 'CLAUDE.local.md', openComments: 0, ignored: true, roundStatus: 'unchanged' },
      { path: 'a.md', openComments: 0, ignored: false, roundStatus: 'unchanged' },
    ]);
  });

  it('keeps an ignored file with a comment visible after showIgnored is switched off', async () => {
    await ws.write('.gitignore', 'CLAUDE.local.md\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await setShowIgnored(ws.root, true);
    await comment('CLAUDE.local.md', 1, 'x');
    await setShowIgnored(ws.root, false);
    expect(await listFiles(ws.root)).toEqual([
      { path: 'CLAUDE.local.md', openComments: 1, ignored: true, roundStatus: 'unchanged' },
    ]);
  });

  it('does not call ignored files new when they were hidden at handoff', async () => {
    await ws.write('.gitignore', 'vendor/\n');
    await ws.write('vendor/README.md', 'x\n');
    await ws.write('a.md', 'x\n');
    await comment('a.md', 1, 'x');
    await handoff(ws.root);
    await setShowIgnored(ws.root, true);
    const vendor = (await listFiles(ws.root)).find((file) => file.path === 'vendor/README.md');
    expect(vendor).toMatchObject({ ignored: true, roundStatus: 'unchanged' });
    expect((await getFileView(ws.root, 'vendor/README.md')).roundStatus).toBe('unchanged');
  });

  it('answers 400 for a showIgnored value that is not a boolean', async () => {
    await expect(setShowIgnored(ws.root, 'yes')).rejects.toMatchObject({ status: 400 });
  });
});
