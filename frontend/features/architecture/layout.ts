/**
 * Small layered ("Sugiyama-lite") layout for the architecture graph, left to right:
 * 1. break cycles by ignoring DFS back edges,
 * 2. assign each node to layer = longest path from any source,
 * 3. order nodes inside a layer by the barycenter of their predecessors (one sweep) to limit crossings,
 * 4. connected nodes go first; resources without relationships are laid out in a grid below.
 * No dependency needed for graphs of this size (tens to a few hundred nodes).
 */

export interface LayoutNode {
  id: string;
  service: string;
  name: string;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  isolatedColumns: number;
}

const DEFAULTS: LayoutOptions = { nodeWidth: 232, nodeHeight: 68, columnGap: 110, rowGap: 34, isolatedColumns: 4 };

export function layeredLayout(nodes: LayoutNode[], edges: LayoutEdge[], options: Partial<LayoutOptions> = {}): Map<string, { x: number; y: number }> {
  const o = { ...DEFAULTS, ...options };
  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);

  const outgoing = new Map<string, string[]>();
  const connected = new Set<string>();
  for (const e of valid) {
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
    connected.add(e.source);
    connected.add(e.target);
  }

  // 1. Drop back edges found by DFS so the remaining graph is a DAG.
  const stable = [...nodes].sort((a, b) => a.service.localeCompare(b.service) || a.name.localeCompare(b.name));
  const state = new Map<string, 0 | 1 | 2>();
  const dag: LayoutEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of outgoing.get(id) ?? []) {
      const s = state.get(t) ?? 0;
      if (s === 1) continue; // back edge
      dag.push({ source: id, target: t });
      if (s === 0) visit(t);
    }
    state.set(id, 2);
  };
  for (const n of stable) if (connected.has(n.id) && !state.get(n.id)) visit(n.id);

  // 2. Longest path layering (Kahn topological order).
  const indegree = new Map<string, number>();
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const id of connected) indegree.set(id, 0);
  const seen = new Set<string>();
  for (const e of dag) {
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    preds.set(e.target, [...(preds.get(e.target) ?? []), e.source]);
    succs.set(e.source, [...(succs.get(e.source) ?? []), e.target]);
  }
  const layer = new Map<string, number>();
  const queue = stable.filter((n) => connected.has(n.id) && indegree.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift() as string;
    for (const t of succs.get(id) ?? []) {
      layer.set(t, Math.max(layer.get(t) ?? 0, (layer.get(id) ?? 0) + 1));
      indegree.set(t, (indegree.get(t) ?? 1) - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }

  // 3. Order within layers by predecessor barycenter.
  const layers: string[][] = [];
  for (const n of stable) {
    if (!connected.has(n.id)) continue;
    const l = layer.get(n.id) ?? 0;
    (layers[l] ??= []).push(n.id);
  }
  const position = new Map<string, number>();
  layers.forEach((ids, l) => {
    if (l > 0) {
      const bary = (id: string) => {
        const p = (preds.get(id) ?? []).map((x) => position.get(x)).filter((v): v is number => v !== undefined);
        return p.length ? p.reduce((a, b) => a + b, 0) / p.length : Number.MAX_SAFE_INTEGER;
      };
      ids.sort((a, b) => bary(a) - bary(b));
    }
    ids.forEach((id, i) => position.set(id, i));
  });

  const result = new Map<string, { x: number; y: number }>();
  const tallest = Math.max(0, ...layers.map((l) => l?.length ?? 0));
  const rowStep = o.nodeHeight + o.rowGap;
  layers.forEach((ids, l) => {
    // Center shorter layers vertically against the tallest one.
    const offset = ((tallest - ids.length) * rowStep) / 2;
    ids.forEach((id, i) => result.set(id, { x: l * (o.nodeWidth + o.columnGap), y: offset + i * rowStep }));
  });

  // 4. Isolated resources in a grid under the connected part.
  const isolated = stable.filter((n) => !connected.has(n.id));
  const top = tallest > 0 ? tallest * rowStep + o.rowGap * 2 : 0;
  const columns = Math.max(o.isolatedColumns, layers.length);
  isolated.forEach((n, i) => {
    result.set(n.id, { x: (i % columns) * (o.nodeWidth + o.columnGap / 2), y: top + Math.floor(i / columns) * rowStep });
  });
  return result;
}
