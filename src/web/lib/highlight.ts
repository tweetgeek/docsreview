import { parseFrontmatter } from './frontmatter.js';

export type TokenKind =
  | 'heading'
  | 'marker'
  | 'quote'
  | 'rule'
  | 'fence'
  | 'code'
  | 'inline-code'
  | 'strong'
  | 'emphasis'
  | 'link-text'
  | 'link-url'
  | 'tag'
  | 'meta-key'
  | 'meta-delimiter';

export interface Segment {
  text: string;
  kind: TokenKind | null;
}

interface Fence {
  char: string;
  length: number;
}

const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const QUOTE = /^\s*>\s?/;
const LIST = /^(\s*)([-*+]|\d+[.)])(?=\s)/;
const CHECKBOX = /^(\s+)(\[[ xX]\])(?=\s|$)/;
const META_KEY = /^[A-Za-z0-9_-]+:/;

const INLINE_CODE = /(`+)(?!`)[^]*?[^`]\1(?!`)/y;
const LINK = /!?\[[^\]]*\]\([^()\s]*(?:\s+"[^"]*")?\)/y;
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>/y;
const TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/y;
const STRONG = /(\*\*|__)(?=\S)[^]*?\S\1/y;
const EMPHASIS = /([*_])(?=[^\s*_])[^]*?\S\1/y;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function whole(text: string, kind: TokenKind): Segment[] {
  return [{ text, kind }];
}

function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index;
  return pattern.exec(text)?.[0] ?? null;
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

function matchEmphasis(pattern: RegExp, text: string, index: number): string | null {
  const match = matchAt(pattern, text, index);
  if (match === null) return null;
  const insideWord = isWordChar(text[index - 1]) || isWordChar(text[index + match.length]);
  return text[index] === '_' && insideWord ? null : match;
}

function special(text: string, index: number): Segment[] | null {
  const char = text[index];
  if (char === '`') {
    const code = matchAt(INLINE_CODE, text, index);
    return code === null ? null : whole(code, 'inline-code');
  }
  if (char === '[' || (char === '!' && text[index + 1] === '[')) {
    const link = matchAt(LINK, text, index);
    if (link === null) return null;
    const split = link.indexOf('](') + 1;
    return [
      { text: link.slice(0, split), kind: 'link-text' },
      { text: link.slice(split), kind: 'link-url' },
    ];
  }
  if (char === '<') {
    const autolink = matchAt(AUTOLINK, text, index);
    if (autolink !== null) return whole(autolink, 'link-url');
    const tag = matchAt(TAG, text, index);
    return tag === null ? null : whole(tag, 'tag');
  }
  if (char === '*' || char === '_') {
    const strong = matchEmphasis(STRONG, text, index);
    if (strong !== null) return whole(strong, 'strong');
    const emphasis = matchEmphasis(EMPHASIS, text, index);
    return emphasis === null ? null : whole(emphasis, 'emphasis');
  }
  return null;
}

function inline(text: string): Segment[] {
  const segments: Segment[] = [];
  let plain = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      plain += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    const found = special(text, index);
    if (found === null) {
      plain += text[index];
      index++;
      continue;
    }
    if (plain !== '') segments.push({ text: plain, kind: null });
    plain = '';
    segments.push(...found);
    index += found.reduce((length, segment) => length + segment.text.length, 0);
  }
  if (plain !== '') segments.push({ text: plain, kind: null });
  return segments;
}

function body(text: string): Segment[] {
  const list = LIST.exec(text);
  if (list === null) return inline(text);
  const segments: Segment[] = [];
  if (list[1] !== '') segments.push({ text: list[1]!, kind: null });
  segments.push({ text: list[2]!, kind: 'marker' });
  let rest = text.slice(list[0].length);
  const checkbox = CHECKBOX.exec(rest);
  if (checkbox !== null) {
    segments.push({ text: checkbox[1]!, kind: null }, { text: checkbox[2]!, kind: 'marker' });
    rest = rest.slice(checkbox[0].length);
  }
  return [...segments, ...inline(rest)];
}

function metaLine(text: string, isDelimiter: boolean): Segment[] {
  if (isDelimiter) return whole(text, 'meta-delimiter');
  const key = META_KEY.exec(text)?.[0];
  if (key === undefined) return [{ text, kind: null }];
  const rest = text.slice(key.length);
  return rest === '' ? whole(key, 'meta-key') : [{ text: key, kind: 'meta-key' }, { text: rest, kind: null }];
}

export function highlightMarkdown(lines: string[]): Segment[][] {
  const frontmatterEnd = parseFrontmatter(lines)?.endLine ?? 0;
  let fence: Fence | null = null;

  return lines.map((text, index) => {
    if (text === '') return [];
    if (index < frontmatterEnd) return metaLine(text, index === 0 || index === frontmatterEnd - 1);

    if (fence !== null) {
      const closing = FENCE_CLOSE.exec(text)?.[1];
      if (closing !== undefined && closing[0] === fence.char && closing.length >= fence.length) {
        fence = null;
        return whole(text, 'fence');
      }
      return whole(text, 'code');
    }
    const opening = FENCE_OPEN.exec(text)?.[1];
    if (opening !== undefined) {
      fence = { char: opening[0]!, length: opening.length };
      return whole(text, 'fence');
    }

    if (HEADING.test(text)) return whole(text, 'heading');
    if (RULE.test(text)) return whole(text, 'rule');
    const quote = QUOTE.exec(text)?.[0];
    if (quote !== undefined) return [{ text: quote, kind: 'quote' }, ...body(text.slice(quote.length))];
    return body(text);
  });
}
