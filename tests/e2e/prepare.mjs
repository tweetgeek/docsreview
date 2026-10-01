import fs from 'node:fs/promises';
import path from 'node:path';

const name = process.argv[2];
if (name === undefined) throw new Error('usage: node tests/e2e/prepare.mjs <name>');

const work = path.resolve('tests/e2e/.work', name);
const guide = ['# Przewodnik', '', 'Uruchom `npm start`.', '', '- krok pierwszy', '- krok drugi', ''].join('\n');

await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(path.join(work, 'root/docs'), { recursive: true });
await fs.mkdir(path.join(work, 'home'), { recursive: true });
await fs.writeFile(path.join(work, 'root/docs/guide.md'), guide);

if (name === 'comments') {
  await fs.writeFile(path.join(work, 'root/docs/Plan wdrożenia #2.md'), '# Plan\n\nTreść planu.\n');
  await fs.writeFile(path.join(work, 'root/docs/links.md'), '# Linki\n\nZobacz [przewodnik](guide.md).\n');
}

if (name === 'ignored') {
  await fs.mkdir(path.join(work, '.git'));
  await fs.writeFile(path.join(work, '.gitignore'), 'root/\n');
} else {
  // The work directory sits inside this repository, whose .gitignore ignores it.
  // A .git directory makes the fixture root its own repository root, so those rules do not apply.
  await fs.mkdir(path.join(work, 'root/.git'));
}
