import { describe, expect, it } from 'vitest';
import { resolveLink } from '../../src/web/lib/links.js';

describe('resolveLink', () => {
  it('resolves a markdown file in the same directory', () => {
    expect(resolveLink('docs/guide.md', 'other.md')).toEqual({ kind: 'file', path: 'docs/other.md' });
    expect(resolveLink('docs/guide.md', './sub/other.md')).toEqual({ kind: 'file', path: 'docs/sub/other.md' });
    expect(resolveLink('README.md', 'docs/guide.md')).toEqual({ kind: 'file', path: 'docs/guide.md' });
  });

  it('resolves ../ segments against the directory of the current file', () => {
    expect(resolveLink('docs/adr/0001.md', '../guide.md')).toEqual({ kind: 'file', path: 'docs/guide.md' });
    expect(resolveLink('docs/adr/0001.md', '../../README.md')).toEqual({ kind: 'file', path: 'README.md' });
  });

  it('refuses a relative link that escapes the working directory', () => {
    expect(resolveLink('docs/guide.md', '../../outside.md')).toEqual({ kind: 'none' });
    expect(resolveLink('README.md', '../README.md')).toEqual({ kind: 'none' });
  });

  it('ignores fragment-only links and absolute paths', () => {
    expect(resolveLink('docs/guide.md', '#install')).toEqual({ kind: 'none' });
    expect(resolveLink('docs/guide.md', '/abs.md')).toEqual({ kind: 'none' });
    expect(resolveLink('docs/guide.md', '//example.com/a.md')).toEqual({ kind: 'none' });
  });

  it('treats http, https and mailto links as external', () => {
    expect(resolveLink('docs/guide.md', 'https://example.com/a.md')).toEqual({ kind: 'external' });
    expect(resolveLink('docs/guide.md', 'http://example.com')).toEqual({ kind: 'external' });
    expect(resolveLink('docs/guide.md', 'mailto:a@example.com')).toEqual({ kind: 'external' });
    expect(resolveLink('docs/guide.md', 'HTTPS://example.com')).toEqual({ kind: 'external' });
  });

  it('refuses other schemes and files that are not markdown', () => {
    expect(resolveLink('docs/guide.md', 'ftp://example.com/a.md')).toEqual({ kind: 'none' });
    expect(resolveLink('docs/guide.md', 'file:///etc/a.md')).toEqual({ kind: 'none' });
    expect(resolveLink('docs/guide.md', 'image.png')).toEqual({ kind: 'none' });
    expect(resolveLink('docs/guide.md', 'notes.txt')).toEqual({ kind: 'none' });
    expect(resolveLink('docs/guide.md', 'sub/')).toEqual({ kind: 'none' });
  });

  it('accepts the .md extension in any case', () => {
    expect(resolveLink('docs/guide.md', 'README.MD')).toEqual({ kind: 'file', path: 'docs/README.MD' });
  });

  it('decodes percent-encoded names with spaces and Polish letters', () => {
    expect(resolveLink('docs/guide.md', 'Plan%20wdro%C5%BCenia%20%232.md')).toEqual({
      kind: 'file',
      path: 'docs/Plan wdrożenia #2.md',
    });
    expect(resolveLink('docs/guide.md', 'zażółć.md')).toEqual({ kind: 'file', path: 'docs/zażółć.md' });
  });

  it('drops the query and fragment after the file name', () => {
    expect(resolveLink('docs/guide.md', 'other.md#section')).toEqual({ kind: 'file', path: 'docs/other.md' });
    expect(resolveLink('docs/guide.md', 'other.md?x=1#section')).toEqual({ kind: 'file', path: 'docs/other.md' });
  });

  it('refuses malformed percent-encoding', () => {
    expect(resolveLink('docs/guide.md', 'bad%E0%A4%A.md')).toEqual({ kind: 'none' });
  });
});
