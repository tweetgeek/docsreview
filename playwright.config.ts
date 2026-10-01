import path from 'node:path';
import { defineConfig } from '@playwright/test';

const servers = [
  { name: 'comments', port: 4599 },
  { name: 'ignored', port: 4600 },
  { name: 'round', port: 4601 },
];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: servers.map(({ name, port }) => ({
    command: `node tests/e2e/prepare.mjs ${name} && node dist/server/cli.js tests/e2e/.work/${name}/root --no-open --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    env: {
      DOCSREVIEW_TOKEN: 'e2e',
      DOCSREVIEW_HOME: path.resolve('tests/e2e/.work', name, 'home'),
    },
  })),
});
