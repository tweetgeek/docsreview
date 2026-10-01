import type { FileEntry } from '../../core/types.js';

export interface TreeNode {
  name: string;
  path: string;
  file: FileEntry | null;
  ignored: boolean;
  openComments: number;
  children: TreeNode[];
}

function finish(nodes: TreeNode[]): { ignored: boolean; openComments: number } {
  nodes.sort((a, b) => {
    if ((a.file === null) !== (b.file === null)) return a.file === null ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  let ignored = nodes.length > 0;
  let openComments = 0;
  for (const node of nodes) {
    if (node.file === null) Object.assign(node, finish(node.children));
    if (!node.ignored) ignored = false;
    openComments += node.openComments;
  }
  return { ignored, openComments };
}

export function buildTree(files: FileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  for (const file of files) {
    const parts = file.path.split('/');
    let siblings = roots;
    for (let index = 0; index < parts.length - 1; index++) {
      const dirPath = parts.slice(0, index + 1).join('/');
      let dir = dirs.get(dirPath);
      if (dir === undefined) {
        dir = { name: parts[index]!, path: dirPath, file: null, ignored: false, openComments: 0, children: [] };
        dirs.set(dirPath, dir);
        siblings.push(dir);
      }
      siblings = dir.children;
    }
    siblings.push({
      name: parts.at(-1)!,
      path: file.path,
      file,
      ignored: file.ignored,
      openComments: file.openComments,
      children: [],
    });
  }
  finish(roots);
  return roots;
}
