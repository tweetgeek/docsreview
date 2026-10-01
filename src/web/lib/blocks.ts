export interface BlockRange {
  start: number;
  end: number;
}

export function findBlockIndex(blocks: BlockRange[], line: number): number {
  let containing = -1;
  let preceding = -1;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    if (block.start <= line && line <= block.end) {
      const best = blocks[containing];
      if (best === undefined || block.end - block.start <= best.end - best.start) containing = index;
    }
    if (block.start <= line) {
      const best = blocks[preceding];
      if (best === undefined || block.start >= best.start) preceding = index;
    }
  }
  if (containing !== -1) return containing;
  if (preceding !== -1) return preceding;
  return blocks.length > 0 ? 0 : -1;
}
