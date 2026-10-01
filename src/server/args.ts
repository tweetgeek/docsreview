import { parseArgs } from 'node:util';

export const DEFAULT_PORT = 4477;

export const USAGE = `Użycie: docsreview [katalog] [--port <n>] [--no-open]

  katalog     katalog roboczy z plikami .md (domyślnie bieżący katalog)
  --port <n>  port serwera (domyślnie ${DEFAULT_PORT}; gdy zajęty, kolejny wolny)
  --no-open   nie otwieraj przeglądarki
  --help      pokaż tę pomoc`;

export interface CliArgs {
  root: string;
  port: number;
  open: boolean;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new Error('Podaj najwyżej jeden katalog');

  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    port = Number(values.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Nieprawidłowy port: ${values.port}`);
    }
  }
  return {
    root: positionals[0] ?? process.cwd(),
    port,
    open: values['no-open'] !== true,
    help: values.help === true,
  };
}
