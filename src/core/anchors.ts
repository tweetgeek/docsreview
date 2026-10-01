import { diffArrays } from 'diff';

export interface LinePosition {
  currentLine: number;
  lineChanged: boolean;
}

export function mapLine(oldLines: string[], newLines: string[], oldLine: number): LinePosition {
  if (newLines.length === 0) return { currentLine: 1, lineChanged: true };
  const parts = diffArrays(oldLines, newLines);
  let oldPos = 0;
  let newPos = 0;
  let index = 0;
  while (index < parts.length) {
    const part = parts[index]!;
    if (!part.added && !part.removed) {
      const count = part.value.length;
      if (oldLine <= oldPos + count) {
        return { currentLine: newPos + (oldLine - oldPos), lineChanged: false };
      }
      oldPos += count;
      newPos += count;
      index++;
      continue;
    }
    let removed = 0;
    let added = 0;
    while (index < parts.length && (parts[index]!.added || parts[index]!.removed)) {
      if (parts[index]!.removed) removed += parts[index]!.value.length;
      else added += parts[index]!.value.length;
      index++;
    }
    if (oldLine <= oldPos + removed) {
      const offset = oldLine - oldPos - 1;
      if (added > 0) {
        return { currentLine: newPos + Math.min(offset, added - 1) + 1, lineChanged: true };
      }
      return { currentLine: Math.min(newPos + 1, newLines.length), lineChanged: true };
    }
    oldPos += removed;
    newPos += added;
  }
  return { currentLine: Math.min(Math.max(oldLine, 1), newLines.length), lineChanged: true };
}

export function changedLines(oldLines: string[], newLines: string[]): number[] {
  const result: number[] = [];
  let newPos = 0;
  for (const part of diffArrays(oldLines, newLines)) {
    if (part.removed) continue;
    if (part.added) {
      for (let offset = 1; offset <= part.value.length; offset++) result.push(newPos + offset);
    }
    newPos += part.value.length;
  }
  return result;
}
