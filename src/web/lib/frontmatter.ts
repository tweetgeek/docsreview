export interface FrontmatterEntry {
  key: string;
  value: string;
  line: number;
  endLine: number;
}

export interface Frontmatter {
  entries: FrontmatterEntry[];
  endLine: number;
}

const DELIMITER = '---';
const KEY_PATTERN = /^([A-Za-z0-9_-]+):\s?(.*)$/;

export function parseFrontmatter(lines: string[]): Frontmatter | null {
  if (lines[0]?.trimEnd() !== DELIMITER) return null;
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === DELIMITER);
  if (closing === -1) return null;

  const entries: FrontmatterEntry[] = [];
  for (let index = 1; index < closing; index++) {
    const text = lines[index]!;
    const lineNumber = index + 1;
    const match = KEY_PATTERN.exec(text);
    const previous = entries.at(-1);
    if (match !== null) {
      entries.push({ key: match[1]!, value: match[2]!, line: lineNumber, endLine: lineNumber });
    } else if (previous !== undefined) {
      previous.value = previous.value === '' ? text.trim() : `${previous.value}\n${text.trim()}`;
      previous.endLine = lineNumber;
    } else {
      entries.push({ key: '', value: text.trim(), line: lineNumber, endLine: lineNumber });
    }
  }
  return { entries, endLine: closing + 1 };
}
