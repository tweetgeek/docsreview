import { randomBytes, timingSafeEqual } from 'node:crypto';

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

export function createToken(): string {
  return process.env.DOCSREVIEW_TOKEN ?? randomBytes(24).toString('hex');
}

export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAllowedUrl(requestUrl: string, port: number): boolean {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }
  const requestPort = url.port === '' ? '80' : url.port;
  return LOCAL_HOSTNAMES.has(url.hostname) && requestPort === String(port);
}
