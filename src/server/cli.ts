#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import open from 'open';
import { parseCliArgs, USAGE, type CliArgs } from './args.js';
import { HttpError } from './errors.js';
import { startServer, type RunningServer } from './start.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const webDir = fileURLToPath(new URL('../web', import.meta.url));
  let server: RunningServer;
  try {
    server = await startServer({ root: args.root, port: args.port, webDir });
  } catch (error) {
    if (error instanceof HttpError) fail(error.message);
    throw error;
  }

  console.log(`DocsReview działa: ${server.url}`);
  console.log(`Katalog roboczy:   ${server.root}`);
  console.log('Zatrzymanie: Ctrl+C');
  if (args.open) await open(server.url);

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await main();
