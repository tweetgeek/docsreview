import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPathIgnored } from '../../src/server/ignore.js';
import { scanFiles } from '../../src/server/scanner.js';
import { makeWorkspace, type Workspace } from '../helpers/tmp.js';

let ws: Workspace;

beforeEach(async () => {
  ws = await makeWorkspace();
});

afterEach(async () => {
  await ws.cleanup();
});

const visible = { showIgnored: false, alwaysInclude: [] };
const everything = { showIgnored: true, alwaysInclude: [] };

async function paths(options = visible): Promise<string[]> {
  return (await scanFiles(ws.root, options)).map((file) => file.path);
}

describe('scanFiles', () => {
  it('finds markdown files recursively, sorted by path, and nothing else', async () => {
    await ws.write('README.md', '# r\n');
    await ws.write('docs/adr/0001.md', '# a\n');
    await ws.write('docs/UPPER.MD', '# u\n');
    await ws.write('docs/notes.txt', 'n\n');
    await ws.write('src/index.ts', 'x\n');
    expect(await paths()).toEqual(['README.md', 'docs/UPPER.MD', 'docs/adr/0001.md']);
  });

  it('scans hidden directories such as .claude', async () => {
    await ws.write('.claude/skills/deploy/SKILL.md', '# s\n');
    expect(await paths()).toEqual(['.claude/skills/deploy/SKILL.md']);
  });

  it('always skips .git and node_modules, even when ignored files are shown', async () => {
    await ws.write('.git/description.md', 'x\n');
    await ws.write('node_modules/pkg/README.md', 'x\n');
    await ws.write('a.md', 'x\n');
    expect(await paths(everything)).toEqual(['a.md']);
  });

  it('does not follow symbolic links', async () => {
    await ws.write('real/a.md', 'x\n');
    await fs.symlink(path.join(ws.root, 'real'), path.join(ws.root, 'linked-dir'));
    await fs.symlink(path.join(ws.root, 'real/a.md'), path.join(ws.root, 'linked.md'));
    expect(await paths()).toEqual(['real/a.md']);
  });

  it('handles file names with spaces, Polish letters and a hash sign', async () => {
    await ws.write('docs/Plan wdrożenia #2.md', 'x\n');
    expect(await paths()).toEqual(['docs/Plan wdrożenia #2.md']);
  });

  it.skipIf(process.getuid?.() === 0)('skips a directory it cannot read instead of failing', async () => {
    await ws.write('ok.md', 'x\n');
    await ws.write('locked/secret.md', 'x\n');
    await fs.chmod(path.join(ws.root, 'locked'), 0o000);
    try {
      expect(await paths()).toEqual(['ok.md']);
    } finally {
      await fs.chmod(path.join(ws.root, 'locked'), 0o755);
    }
  });

  it('does not list snapshots when the DocsReview home is inside the root', async () => {
    await ws.write('a.md', 'x\n');
    const nestedHome = path.join(ws.root, '.docsreview');
    process.env.DOCSREVIEW_HOME = nestedHome;
    await fs.mkdir(path.join(nestedHome, 'reviews/x/snapshots'), { recursive: true });
    await fs.writeFile(path.join(nestedHome, 'reviews/x/snapshots/abc.md'), 'x\n');
    expect(await paths()).toEqual(['a.md']);
  });
});

describe('ignored files', () => {
  it('hides files matched by .gitignore in the root', async () => {
    await ws.write('.gitignore', 'vendor/\n*.local.md\n');
    await ws.write('vendor/pkg/README.md', 'x\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await ws.write('docs/a.md', 'x\n');
    expect(await paths()).toEqual(['docs/a.md']);
  });

  it('shows them flagged as ignored when showIgnored is on', async () => {
    await ws.write('.gitignore', 'vendor/\n*.local.md\n');
    await ws.write('vendor/pkg/README.md', 'x\n');
    await ws.write('CLAUDE.local.md', 'x\n');
    await ws.write('docs/a.md', 'x\n');
    expect(await scanFiles(ws.root, everything)).toEqual([
      { path: 'CLAUDE.local.md', ignored: true },
      { path: 'docs/a.md', ignored: false },
      { path: 'vendor/pkg/README.md', ignored: true },
    ]);
  });

  it('applies a .gitignore in a subdirectory to that subdirectory only', async () => {
    await ws.write('docs/.gitignore', 'drafts/\n');
    await ws.write('docs/drafts/a.md', 'x\n');
    await ws.write('drafts/b.md', 'x\n');
    expect(await paths()).toEqual(['drafts/b.md']);
  });

  it('applies .gitignore files from parent directories up to the repository root', async () => {
    await fs.mkdir(path.join(ws.root, '.git'));
    await ws.write('.gitignore', 'generated/\n');
    await ws.write('docs/generated/a.md', 'x\n');
    await ws.write('docs/b.md', 'x\n');
    const sub = path.join(ws.root, 'docs');
    expect((await scanFiles(sub, visible)).map((file) => file.path)).toEqual(['b.md']);
  });

  it('ignores parent .gitignore files when the root is not inside a repository', async () => {
    await ws.write('.gitignore', 'generated/\n');
    await ws.write('docs/generated/a.md', 'x\n');
    const sub = path.join(ws.root, 'docs');
    expect((await scanFiles(sub, visible)).map((file) => file.path)).toEqual(['generated/a.md']);
  });

  it('shows nothing by default when the root itself is ignored, and everything flagged with showIgnored', async () => {
    await fs.mkdir(path.join(ws.root, '.git'));
    await ws.write('.gitignore', '.superpowers/\n');
    await ws.write('.superpowers/plan.md', 'x\n');
    const sub = path.join(ws.root, '.superpowers');
    expect(await scanFiles(sub, visible)).toEqual([]);
    expect(await scanFiles(sub, everything)).toEqual([{ path: 'plan.md', ignored: true }]);
  });

  it('always includes an ignored file that has comments', async () => {
    await ws.write('.gitignore', '.superpowers/\n');
    await ws.write('.superpowers/plan.md', 'x\n');
    await ws.write('.superpowers/other.md', 'x\n');
    await ws.write('a.md', 'x\n');
    const files = await scanFiles(ws.root, { showIgnored: false, alwaysInclude: ['.superpowers/plan.md', 'gone.md'] });
    expect(files).toEqual([
      { path: '.superpowers/plan.md', ignored: true },
      { path: 'a.md', ignored: false },
    ]);
  });

  it('keeps working when a .gitignore cannot be read', async () => {
    await fs.mkdir(path.join(ws.root, '.gitignore'));
    await ws.write('a.md', 'x\n');
    expect(await paths()).toEqual(['a.md']);
  });
});

describe('isPathIgnored', () => {
  it('agrees with the scanner for single files', async () => {
    await ws.write('.gitignore', 'vendor/\n*.local.md\n');
    await ws.write('docs/.gitignore', 'drafts/\n');
    expect(await isPathIgnored(ws.root, 'vendor/pkg/README.md')).toBe(true);
    expect(await isPathIgnored(ws.root, 'CLAUDE.local.md')).toBe(true);
    expect(await isPathIgnored(ws.root, 'docs/drafts/a.md')).toBe(true);
    expect(await isPathIgnored(ws.root, 'docs/a.md')).toBe(false);
  });

  it('treats every file as ignored when the root itself is ignored', async () => {
    await fs.mkdir(path.join(ws.root, '.git'));
    await ws.write('.gitignore', '.superpowers/\n');
    await ws.write('.superpowers/plan.md', 'x\n');
    expect(await isPathIgnored(path.join(ws.root, '.superpowers'), 'plan.md')).toBe(true);
  });
});
