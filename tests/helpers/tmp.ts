import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface Workspace {
  root: string;
  home: string;
  write(relPath: string, content: string): Promise<void>;
  remove(relPath: string): Promise<void>;
  cleanup(): Promise<void>;
}

export async function makeWorkspace(): Promise<Workspace> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'docsreview-')));
  const root = path.join(base, 'work');
  const home = path.join(base, 'home');
  await fs.mkdir(root);
  await fs.mkdir(home);
  process.env.DOCSREVIEW_HOME = home;
  return {
    root,
    home,
    async write(relPath, content) {
      const file = path.join(root, relPath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf8');
    },
    async remove(relPath) {
      await fs.rm(path.join(root, relPath), { recursive: true, force: true });
    },
    async cleanup() {
      delete process.env.DOCSREVIEW_HOME;
      await fs.rm(base, { recursive: true, force: true });
    },
  };
}
