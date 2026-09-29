import type { ElementIR, GroupElementIR, TextElementIR } from './model';

/** Expand minimum row heights without shrinking text or leaving borders behind. */
export async function layoutTable(source: GroupElementIR, measure: (text: TextElementIR) => Promise<number>): Promise<GroupElementIR> {
  const grid = source.tableGrid;
  if (!grid) return source;
  const nodes = new Map<string, ElementIR>();
  const copy = (node: ElementIR): ElementIR => {
    const result = { ...node, bounds: { ...node.bounds }, ...('children' in node ? { children: node.children.map(copy) } : {}) };
    nodes.set(result.id, result);
    return result;
  };
  const root = copy(source) as GroupElementIR;
  delete root.tableGrid;
  const heights = [...grid.rowHeights];
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const deadline = Date.now() + 30000;
  const group = (id: string) => {
    const node = nodes.get(id);
    if (!node || !('children' in node)) throw new Error('invalid-table-layout');
    return node;
  };
  for (const anchor of [...grid.cells].sort((a, b) => a.rowSpan - b.rowSpan)) {
    const cell = group(anchor.id);
    let required = cell.bounds.height;
    for (const text of cell.children) {
      if (text.kind !== 'text' || !text.visible || text.rotation) continue;
      if (Date.now() > deadline) throw new Error('text-layout-limit');
      const measured = await measure(text);
      if (Date.now() > deadline || !Number.isFinite(measured) || measured < 0 || measured > 1000000) throw new Error('text-layout-limit');
      const bottom = Math.max(0, cell.bounds.height - text.bounds.y - text.bounds.height);
      required = Math.max(required, text.bounds.y + measured + bottom);
    }
    const current = sum(heights.slice(anchor.row, anchor.row + anchor.rowSpan));
    if (required > current) heights[anchor.row + anchor.rowSpan - 1]! += required - current;
  }
  const height = sum(heights);
  if (!Number.isFinite(height) || height > 1000000) throw new Error('text-layout-limit');
  const ys = [0];
  for (const value of heights) ys.push(ys[ys.length - 1]! + value);
  for (const anchor of grid.cells) {
    const cell = group(anchor.id), oldHeight = cell.bounds.height;
    const nextHeight = ys[anchor.row + anchor.rowSpan]! - ys[anchor.row]!;
    cell.bounds.y = grid.rows.length ? 0 : ys[anchor.row]!;
    cell.bounds.height = nextHeight;
    for (const child of cell.children) {
      if (child.kind === 'text') child.bounds.height += nextHeight - oldHeight;
      else scaleY(child, nextHeight / oldHeight);
    }
    if (anchor.borderId) {
      const border = group(anchor.borderId);
      border.bounds.y = ys[anchor.row]!;
      border.bounds.height = nextHeight;
      for (const child of border.children) {
        // Horizontal compound/gradient bands move with the edge; their thickness stays fixed.
        if (child.name === 'Cell bottom border') child.bounds.y += nextHeight - oldHeight;
        else if (child.name !== 'Cell top border') scaleY(child, nextHeight / oldHeight);
      }
    }
  }
  for (const [i, id] of grid.rows.entries()) {
    const row = group(id); row.bounds.y = ys[i]!; row.bounds.height = heights[i]!;
  }
  for (const id of grid.containers) group(id).bounds.height = height;
  root.bounds.height = height;
  return root;
}

function scaleY(node: ElementIR, factor: number): void {
  node.bounds.y *= factor; node.bounds.height *= factor;
  if (![node.bounds.y,node.bounds.height].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000000)) throw new Error('text-layout-limit');
  if ('children' in node) for (const child of node.children) scaleY(child, factor);
  if (node.kind === 'path' && node.pathData) {
    let ordinate = 0;
    node.pathData = node.pathData.replace(/[MLCQZ]|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi, token => {
      if (/^[MLCQZ]$/i.test(token)) { ordinate = 0; return token; }
      const value=Number(token) * (ordinate++ % 2 ? factor : 1);
      if(!Number.isFinite(value)||Math.abs(value)>1000000)throw new Error('text-layout-limit');
      return String(value);
    });
  }
}
