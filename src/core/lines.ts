export function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (content.endsWith('\n')) lines.pop();
  return lines;
}
