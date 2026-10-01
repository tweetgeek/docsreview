export type LinkTarget = { kind: 'external' } | { kind: 'file'; path: string } | { kind: 'none' };

const EXTERNAL = /^(https?|mailto):/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN = /\.md$/i;

export function resolveLink(currentFile: string, href: string): LinkTarget {
  if (EXTERNAL.test(href)) return { kind: 'external' };
  if (SCHEME.test(href) || href.startsWith('#') || href.startsWith('/')) return { kind: 'none' };

  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/, 1)[0]!);
  } catch {
    return { kind: 'none' };
  }
  if (decoded.endsWith('/')) return { kind: 'none' };

  const segments = currentFile.split('/').slice(0, -1);
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return { kind: 'none' };
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const path = segments.join('/');
  return MARKDOWN.test(path) ? { kind: 'file', path } : { kind: 'none' };
}
