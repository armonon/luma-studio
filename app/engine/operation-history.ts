/**
 * A bounded, branch-preserving history for editor operations.
 *
 * The graph deliberately owns history topology only. Operation payloads remain
 * opaque so bitmap patches can move to tiled storage without changing undo,
 * branching, collaboration, or UI code.
 */

export type OperationNode<T> = {
  id: string;
  parentId: string | null;
  childIds: string[];
  label: string;
  createdAt: number;
  sequence: number;
  value: T | null;
};

export type OperationNodeView = {
  id: string;
  parentId: string | null;
  label: string;
  createdAt: number;
  depth: number;
  childCount: number;
  isCurrent: boolean;
  isOnCurrentPath: boolean;
};

export type HistoryTransition<T> = {
  undo: OperationNode<T>[];
  redo: OperationNode<T>[];
};

export type OperationHistorySnapshot<T> = {
  format: "luma-operation-history";
  version: 1;
  rootId: string;
  currentId: string;
  sequence: number;
  preferredChildren: Array<[parentId: string, childId: string]>;
  nodes: OperationNode<T>[];
};

export type OperationHistoryOptions = {
  maxNodes?: number;
  idFactory?: () => string;
  now?: () => number;
};

let operationId = 0;

function defaultIdFactory() {
  operationId += 1;
  return `op-${Date.now().toString(36)}-${operationId.toString(36)}`;
}

export class OperationHistory<T> {
  rootId: string;

  private readonly nodes = new Map<string, OperationNode<T>>();
  private readonly preferredChildren = new Map<string, string>();
  private readonly maxNodes: number;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private currentId: string;
  private sequence = 0;

  constructor(options: OperationHistoryOptions = {}) {
    this.maxNodes = Math.max(1, Math.floor(options.maxNodes ?? 500));
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.now = options.now ?? Date.now;
    this.rootId = this.uniqueId("history-root");
    this.currentId = this.rootId;
    this.nodes.set(this.rootId, {
      id: this.rootId,
      parentId: null,
      childIds: [],
      label: "Document opened",
      createdAt: this.now(),
      sequence: this.sequence,
      value: null,
    });
  }

  static fromSnapshot<T>(
    snapshot: OperationHistorySnapshot<T>,
    options: OperationHistoryOptions = {},
  ) {
    if (!snapshot || snapshot.format !== "luma-operation-history" || snapshot.version !== 1) {
      throw new Error("Unsupported Luma operation history");
    }
    if (!Array.isArray(snapshot.nodes) || !snapshot.nodes.length) {
      throw new Error("Operation history has no root node");
    }

    const graph = new OperationHistory<T>({
      ...options,
      maxNodes: options.maxNodes ?? Math.max(500, snapshot.nodes.length - 1),
    });
    graph.nodes.clear();
    graph.preferredChildren.clear();
    graph.rootId = snapshot.rootId;
    graph.currentId = snapshot.currentId;
    graph.sequence = snapshot.sequence;

    for (const source of snapshot.nodes) {
      if (!source || typeof source.id !== "string" || graph.nodes.has(source.id)) {
        throw new Error("Operation history contains an invalid or duplicate node");
      }
      graph.nodes.set(source.id, {
        ...source,
        childIds: [...source.childIds],
      });
    }
    for (const pair of snapshot.preferredChildren ?? []) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
        graph.preferredChildren.set(pair[0], pair[1]);
      }
    }
    graph.validateTopology();
    graph.trim();
    return graph;
  }

  get current() { return this.currentId; }

  get size() { return this.nodes.size - 1; }

  canUndo() { return this.currentId !== this.rootId; }

  canRedo() { return this.currentNode().childIds.length > 0; }

  commit(label: string, value: T): OperationNode<T> {
    const parent = this.currentNode();
    const node: OperationNode<T> = {
      id: this.uniqueId(),
      parentId: parent.id,
      childIds: [],
      label,
      createdAt: this.now(),
      sequence: ++this.sequence,
      value,
    };
    this.nodes.set(node.id, node);
    parent.childIds.push(node.id);
    this.preferredChildren.set(parent.id, node.id);
    this.currentId = node.id;
    this.trim();
    return node;
  }

  undo(): OperationNode<T> | null {
    const node = this.currentNode();
    if (node.id === this.rootId || !node.parentId) return null;
    this.preferredChildren.set(node.parentId, node.id);
    this.currentId = node.parentId;
    return node;
  }

  redo(childId?: string): OperationNode<T> | null {
    const current = this.currentNode();
    if (!current.childIds.length) return null;
    const preferred = childId ?? this.preferredChildren.get(current.id);
    const nextId = preferred && current.childIds.includes(preferred)
      ? preferred
      : current.childIds[current.childIds.length - 1];
    const next = this.nodes.get(nextId);
    if (!next) return null;
    this.preferredChildren.set(current.id, next.id);
    this.currentId = next.id;
    return next;
  }

  branches(nodeId = this.currentId): OperationNodeView[] {
    const node = this.requireNode(nodeId);
    const currentPath = new Set(this.lineageIds(this.currentId));
    return node.childIds.map((id) => this.view(this.requireNode(id), currentPath));
  }

  lineage(nodeId = this.currentId): OperationNode<T>[] {
    return this.lineageIds(nodeId)
      .map((id) => this.requireNode(id))
      .filter((node) => node.value !== null);
  }

  /** Move the cursor and return the exact operation path Studio must apply. */
  checkout(targetId: string): HistoryTransition<T> {
    this.requireNode(targetId);
    if (targetId === this.currentId) return { undo: [], redo: [] };

    const currentPath = this.lineageIds(this.currentId);
    const targetPath = this.lineageIds(targetId);
    let shared = 0;
    while (
      shared < currentPath.length &&
      shared < targetPath.length &&
      currentPath[shared] === targetPath[shared]
    ) shared += 1;

    const undoIds = currentPath.slice(shared).reverse();
    const redoIds = targetPath.slice(shared);
    const undo = undoIds.map((id) => this.requireNode(id)).filter(hasValue);
    const redo = redoIds.map((id) => this.requireNode(id)).filter(hasValue);

    for (const node of undo) {
      if (node.parentId) this.preferredChildren.set(node.parentId, node.id);
    }
    for (const node of redo) {
      if (node.parentId) this.preferredChildren.set(node.parentId, node.id);
    }
    this.currentId = targetId;
    return { undo, redo };
  }

  tree(): OperationNodeView[] {
    const result: OperationNodeView[] = [];
    const currentPath = new Set(this.lineageIds(this.currentId));
    const walk = (id: string, depth: number) => {
      const node = this.requireNode(id);
      result.push(this.view(node, currentPath, depth));
      for (const childId of node.childIds) walk(childId, depth + 1);
    };
    walk(this.rootId, 0);
    return result;
  }

  summary() {
    let branchPoints = 0;
    for (const node of this.nodes.values()) {
      if (node.childIds.length > 1) branchPoints += 1;
    }
    return {
      currentId: this.currentId,
      rootId: this.rootId,
      operations: this.size,
      branchPoints,
      currentDepth: this.lineageIds(this.currentId).length - 1,
    };
  }

  snapshot(): OperationHistorySnapshot<T> {
    return {
      format: "luma-operation-history",
      version: 1,
      rootId: this.rootId,
      currentId: this.currentId,
      sequence: this.sequence,
      preferredChildren: [...this.preferredChildren.entries()],
      nodes: [...this.nodes.values()].map((node) => ({
        ...node,
        childIds: [...node.childIds],
      })),
    };
  }

  private currentNode() { return this.requireNode(this.currentId); }

  private requireNode(id: string) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Unknown history operation: ${id}`);
    return node;
  }

  private lineageIds(nodeId: string) {
    const ids: string[] = [];
    let node: OperationNode<T> | undefined = this.requireNode(nodeId);
    while (node) {
      ids.push(node.id);
      node = node.parentId ? this.nodes.get(node.parentId) : undefined;
    }
    return ids.reverse();
  }

  private view(node: OperationNode<T>, currentPath: Set<string>, depth?: number): OperationNodeView {
    return {
      id: node.id,
      parentId: node.parentId,
      label: node.label,
      createdAt: node.createdAt,
      depth: depth ?? this.lineageIds(node.id).length - 1,
      childCount: node.childIds.length,
      isCurrent: node.id === this.currentId,
      isOnCurrentPath: currentPath.has(node.id),
    };
  }

  private uniqueId(fallback?: string) {
    let id = fallback ?? this.idFactory();
    while (this.nodes.has(id)) id = this.idFactory();
    return id;
  }

  private validateTopology() {
    const root = this.nodes.get(this.rootId);
    if (!root || root.parentId !== null || root.value !== null) {
      throw new Error("Operation history root is invalid");
    }
    if (!this.nodes.has(this.currentId)) {
      throw new Error("Operation history current node is missing");
    }

    for (const node of this.nodes.values()) {
      if (!Array.isArray(node.childIds) || new Set(node.childIds).size !== node.childIds.length) {
        throw new Error(`Operation history children are invalid: ${node.id}`);
      }
      if (node.id !== this.rootId) {
        const parent = node.parentId ? this.nodes.get(node.parentId) : undefined;
        if (!parent || !parent.childIds.includes(node.id)) {
          throw new Error(`Operation history parent is invalid: ${node.id}`);
        }
      }
      for (const childId of node.childIds) {
        const child = this.nodes.get(childId);
        if (!child || child.parentId !== node.id) {
          throw new Error(`Operation history child is invalid: ${childId}`);
        }
      }
    }

    const visited = new Set<string>();
    const visit = (id: string) => {
      if (visited.has(id)) throw new Error("Operation history contains a cycle");
      visited.add(id);
      for (const childId of this.requireNode(id).childIds) visit(childId);
    };
    visit(this.rootId);
    if (visited.size !== this.nodes.size) {
      throw new Error("Operation history contains unreachable nodes");
    }

    for (const [parentId, childId] of this.preferredChildren) {
      const parent = this.nodes.get(parentId);
      if (!parent?.childIds.includes(childId)) this.preferredChildren.delete(parentId);
    }
    this.sequence = Math.max(this.sequence, ...[...this.nodes.values()].map((node) => node.sequence));
  }

  private trim() {
    while (this.size > this.maxNodes) {
      const protectedIds = new Set(this.lineageIds(this.currentId));
      const removableLeaf = [...this.nodes.values()]
        .filter((node) => node.id !== this.rootId && node.childIds.length === 0 && !protectedIds.has(node.id))
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (removableLeaf) {
        this.removeLeaf(removableLeaf);
        continue;
      }

      const root = this.requireNode(this.rootId);
      const oldest = root.childIds
        .map((id) => this.requireNode(id))
        .sort((a, b) => a.sequence - b.sequence)[0];
      if (!oldest) break;
      this.collapseIntoRoot(oldest);
    }
  }

  private removeLeaf(node: OperationNode<T>) {
    if (!node.parentId) return;
    const parent = this.requireNode(node.parentId);
    parent.childIds = parent.childIds.filter((id) => id !== node.id);
    if (this.preferredChildren.get(parent.id) === node.id) {
      const replacement = parent.childIds[parent.childIds.length - 1];
      if (replacement) this.preferredChildren.set(parent.id, replacement);
      else this.preferredChildren.delete(parent.id);
    }
    this.preferredChildren.delete(node.id);
    this.nodes.delete(node.id);
  }

  private collapseIntoRoot(node: OperationNode<T>) {
    const root = this.requireNode(this.rootId);
    const index = root.childIds.indexOf(node.id);
    const children = [...node.childIds];
    root.childIds.splice(index, 1, ...children);
    for (const childId of children) this.requireNode(childId).parentId = root.id;

    if (this.preferredChildren.get(root.id) === node.id) {
      const nextOnCurrentPath = children.find((id) => this.lineageIds(this.currentId).includes(id));
      const replacement = nextOnCurrentPath ?? children[children.length - 1];
      if (replacement) this.preferredChildren.set(root.id, replacement);
      else this.preferredChildren.delete(root.id);
    }
    this.preferredChildren.delete(node.id);
    this.nodes.delete(node.id);
  }
}

function hasValue<T>(node: OperationNode<T>): node is OperationNode<T> & { value: T } {
  return node.value !== null;
}
