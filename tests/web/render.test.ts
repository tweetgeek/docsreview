import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/core/lines.js';
import { parseFrontmatter } from '../../src/web/lib/frontmatter.js';
import { renderMarkdown } from '../../src/web/lib/render.js';

function blocks(html: string): Array<[string, number, number]> {
  return [...html.matchAll(/<(\w+)[^>]*\bdata-block=""[^>]*>/g)].map((match) => {
    const tag = match[0];
    const start = Number(/data-line-start="(\d+)"/.exec(tag)![1]);
    const end = Number(/data-line-end="(\d+)"/.exec(tag)![1]);
    return [match[1]!, start, end];
  });
}

const DOCUMENT = [
  '# Title', // 1
  '', // 2
  'Para line one', // 3
  'para line two', // 4
  '', // 5
  '- item a', // 6
  '- item b', // 7
  '  - nested', // 8
  '', // 9
  '| h1 | h2 |', // 10
  '|----|----|', // 11
  '| c1 | c2 |', // 12
  '', // 13
  '```sh', // 14
  'npx docsreview', // 15
  '', // 16
  'echo done', // 17
  '```', // 18
  '', // 19
  '> quote', // 20
  '', // 21
  '---', // 22
].join('\n');

describe('renderMarkdown', () => {
  it('marks every commentable block with its source line range', () => {
    expect(blocks(renderMarkdown(DOCUMENT))).toEqual([
      ['h1', 1, 1],
      ['p', 3, 4],
      ['li', 6, 6],
      ['li', 7, 9],
      ['li', 8, 9],
      ['tr', 10, 10],
      ['tr', 12, 12],
      ['span', 15, 15],
      ['span', 16, 16],
      ['span', 17, 17],
      ['p', 20, 20],
      ['hr', 22, 22],
    ]);
  });

  it('renders each line of a fenced code block separately and keeps the language', () => {
    const html = renderMarkdown(DOCUMENT);
    expect(html).toContain('<pre class="code-block" data-line-start="14" data-line-end="18" data-lang="sh">');
    expect(html).toContain('<span class="code-line" data-block="" data-line-start="15" data-line-end="15">npx docsreview</span>');
    expect(html).toContain('<span class="code-line" data-block="" data-line-start="16" data-line-end="16"></span>');
  });

  it('numbers the lines of an indented code block', () => {
    expect(blocks(renderMarkdown('para\n\n    first\n    second\n'))).toEqual([
      ['p', 1, 1],
      ['span', 3, 3],
      ['span', 4, 4],
    ]);
  });

  it('numbers code lines inside a list item and in a fence that is never closed', () => {
    expect(blocks(renderMarkdown('- item\n\n  ```\n  code\n  ```\n')).filter(([tag]) => tag === 'span')).toEqual([
      ['span', 4, 4],
    ]);
    expect(blocks(renderMarkdown('```\ncode'))).toEqual([['span', 2, 2]]);
  });

  it('uses the same line numbers for CRLF files and files without a trailing newline', () => {
    const expected = [
      ['h1', 1, 1],
      ['p', 3, 3],
    ];
    expect(blocks(renderMarkdown('# T\r\n\r\npara\r\n'))).toEqual(expected);
    expect(blocks(renderMarkdown('# T\n\npara'))).toEqual(expected);
    expect(splitLines('# T\r\n\r\npara\r\n')).toHaveLength(3);
  });

  it('shows HTML and XML tags from the file as text', () => {
    const html = renderMarkdown('<HARD-GATE>\nstop\n</HARD-GATE>\n\n<script>alert(1)</script>\n');
    expect(html).toContain('&lt;HARD-GATE&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('does not load images and opens links in a new tab without a referrer', () => {
    const html = renderMarkdown('![alt](https://example.com/x.png)\n\n[link](https://example.com)\n\n[bad](javascript:alert(1))\n');
    expect(html).not.toContain('<img');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).not.toContain('href="javascript:');
  });

  it('renders frontmatter as a table and offsets the body lines', () => {
    const html = renderMarkdown('---\nname: deploy\ndescription: Use when\n  deploying <things>\n---\n\n# Title\n');
    expect(html).toContain('<table class="frontmatter" data-line-start="1" data-line-end="5">');
    expect(html).toContain('<th>name</th><td>deploy</td>');
    expect(html).toContain('<td>Use when\ndeploying &lt;things&gt;</td>');
    expect(blocks(html)).toEqual([
      ['tr', 2, 2],
      ['tr', 3, 4],
      ['h1', 7, 7],
    ]);
  });

  it('renders a file as plain markdown when the frontmatter is never closed', () => {
    const html = renderMarkdown('---\nname: deploy\n\ntext\n');
    expect(html).not.toContain('class="frontmatter"');
    expect(html).toContain('<hr');
  });

  it('renders an empty file as nothing', () => {
    expect(renderMarkdown('')).toBe('');
  });
});

describe('parseFrontmatter', () => {
  it('returns null without an opening or a closing delimiter', () => {
    expect(parseFrontmatter(['# Title'])).toBeNull();
    expect(parseFrontmatter(['---', 'name: x'])).toBeNull();
    expect(parseFrontmatter([])).toBeNull();
  });

  it('splits keys and values and records their lines', () => {
    expect(parseFrontmatter(['---', 'name: deploy', 'description: "Use: when"', '---', 'body'])).toEqual({
      entries: [
        { key: 'name', value: 'deploy', line: 2, endLine: 2 },
        { key: 'description', value: '"Use: when"', line: 3, endLine: 3 },
      ],
      endLine: 4,
    });
  });

  it('attaches continuation lines to the previous key', () => {
    const result = parseFrontmatter(['---', 'description: >', '  first', '  second', 'name: x', '---']);
    expect(result!.entries).toEqual([
      { key: 'description', value: '>\nfirst\nsecond', line: 2, endLine: 4 },
      { key: 'name', value: 'x', line: 5, endLine: 5 },
    ]);
  });

  it('keeps a line that comes before any key', () => {
    expect(parseFrontmatter(['---', '# comment', 'name: x', '---'])!.entries[0]).toEqual({
      key: '',
      value: '# comment',
      line: 2,
      endLine: 2,
    });
  });

  it('accepts an empty block and CRLF line endings already split by splitLines', () => {
    expect(parseFrontmatter(['---', '---'])).toEqual({ entries: [], endLine: 2 });
    expect(parseFrontmatter(splitLines('---\r\nname: x\r\n---\r\n'))!.entries).toHaveLength(1);
  });
});
