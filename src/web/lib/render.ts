import Markdown, { type MarkdownIt, type RendererRule } from 'markdown-it';
import { splitLines } from '../../core/lines.js';
import { parseFrontmatter, type Frontmatter } from './frontmatter.js';
import { resolveLink } from './links.js';

interface RenderEnv {
  lineOffset?: number;
}

const COMMENTABLE = new Set(['heading_open', 'paragraph_open', 'list_item_open', 'tr_open', 'hr']);

function createMarkdown(): MarkdownIt {
  const md = new Markdown({ html: false, linkify: false });
  md.disable('image');

  md.core.ruler.push('source_lines', (state) => {
    const offset = (state.env as RenderEnv).lineOffset ?? 0;
    for (const token of state.tokens) {
      if (token.map === null) continue;
      if (token.nesting !== 1 && token.type !== 'hr') continue;
      token.attrSet('data-line-start', String(token.map[0] + 1 + offset));
      token.attrSet('data-line-end', String(token.map[1] + offset));
      if (COMMENTABLE.has(token.type) && !token.hidden) token.attrSet('data-block', '');
    }
  });

  const renderCode: RendererRule = (tokens, index, _options, env) => {
    const token = tokens[index]!;
    const offset = (env as RenderEnv).lineOffset ?? 0;
    const [start, end] = token.map ?? [0, 0];
    const firstLine = start + 1 + offset + (token.type === 'fence' ? 1 : 0);
    const lines = token.content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const body = lines
      .map((line, lineIndex) => {
        const number = firstLine + lineIndex;
        return `<span class="code-line" data-block="" data-line-start="${number}" data-line-end="${number}">${md.utils.escapeHtml(line)}</span>`;
      })
      .join('');
    const language = token.type === 'fence' ? token.info.trim().split(/\s+/)[0] ?? '' : '';
    const languageAttr = language === '' ? '' : ` data-lang="${md.utils.escapeHtml(language)}"`;
    return `<pre class="code-block" data-line-start="${start + 1 + offset}" data-line-end="${end + offset}"${languageAttr}><code>${body}</code></pre>\n`;
  };
  md.renderer.rules.fence = renderCode;
  md.renderer.rules.code_block = renderCode;

  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const token = tokens[index]!;
    if (resolveLink('', String(token.attrGet('href') ?? '')).kind === 'external') {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
  };

  return md;
}

const markdown = createMarkdown();

function renderFrontmatter(frontmatter: Frontmatter): string {
  const rows = frontmatter.entries
    .map(
      (entry) =>
        `<tr data-block="" data-line-start="${entry.line}" data-line-end="${entry.endLine}">` +
        `<th>${markdown.utils.escapeHtml(entry.key)}</th><td>${markdown.utils.escapeHtml(entry.value)}</td></tr>`,
    )
    .join('\n');
  return `<table class="frontmatter" data-line-start="1" data-line-end="${frontmatter.endLine}"><tbody>\n${rows}\n</tbody></table>\n`;
}

export function renderMarkdown(content: string): string {
  const lines = splitLines(content);
  const frontmatter = parseFrontmatter(lines);
  if (frontmatter === null) return markdown.render(lines.join('\n'), { lineOffset: 0 });
  const body = lines.slice(frontmatter.endLine).join('\n');
  return renderFrontmatter(frontmatter) + markdown.render(body, { lineOffset: frontmatter.endLine });
}
