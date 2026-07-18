import { User } from './user.model';
import { TagLite } from './tag.model';

export type ProjectItemType = 'group' | 'task' | 'subtask';
export type ProjectItemStatus = 'todo' | 'doing' | 'completed';
export type ProjectItemPriority = 'low' | 'medium' | 'high';

export const MAX_PROJECT_ITEM_DEPTH = 4; // depths 0-4 => 5 levels total

export interface ProjectItem {
  id: number;
  numericId?: number | null;
  project: number;
  parentId: number | null;
  type: ProjectItemType;
  title: string;
  description: string;
  status: ProjectItemStatus;
  priority: ProjectItemPriority;
  assignedTo: User | null;
  createdBy: User;
  updatedBy?: User | null;
  depth: number;
  order: number;
  startDate: string | null;
  endDate: string | null;
  tags: TagLite[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectItemPayload {
  title: string;
  description?: string;
  priority?: ProjectItemPriority;
  assignedTo?: number | null;
  parentId?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  tags?: number[];
}

export interface UpdateProjectItemPayload {
  title?: string;
  description?: string;
  priority?: ProjectItemPriority;
  assignedTo?: number | null;
  status?: ProjectItemStatus;
  startDate?: string | null;
  endDate?: string | null;
  tags?: number[];
}

// Frontend-only: recursive tree built client-side from the flat ProjectItem[] response.
export interface ProjectTreeNode extends ProjectItem {
  children: ProjectTreeNode[];
  childCount: number;
}

// Per-item meta for card views (Kanban): cover image + comment count,
// fetched in one batched request rather than per card.
export interface ProjectItemSummary {
  commentCount: number;
  cover: { attachmentId: number; fileName: string; mimeType: string } | null;
}

export interface CompletionRollup {
  percent: number;
  completed: number;
  doing: number;
  total: number;
}

// Walks a subtree counting leaf items (no children — the actual actionable work)
// by status, so a group/task with nested items can show an aggregate completion badge.
export function computeCompletionRollup(nodes: ProjectTreeNode[]): CompletionRollup {
  let completed = 0;
  let doing = 0;
  let total = 0;
  const walk = (list: ProjectTreeNode[]) => {
    for (const n of list) {
      if (n.type !== 'group' && n.children.length === 0) {
        total++;
        if (n.status === 'completed') completed++;
        else if (n.status === 'doing') doing++;
      } else {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { percent, completed, doing, total };
}

// Walks a tree and returns only the leaf nodes (no children) — the actionable
// work items a Kanban board should show as cards, since status/priority on a
// group with children is derived/rolled-up rather than directly editable.
export function flattenLeaves(nodes: ProjectTreeNode[]): ProjectTreeNode[] {
  const leaves: ProjectTreeNode[] = [];
  const walk = (list: ProjectTreeNode[]) => {
    for (const n of list) {
      if (n.type !== 'group' && n.children.length === 0) leaves.push(n);
      else walk(n.children);
    }
  };
  walk(nodes);
  return leaves;
}

export function buildProjectTree(items: ProjectItem[]): ProjectTreeNode[] {
  const byId = new Map<number, ProjectTreeNode>();
  items.forEach((item) => byId.set(item.id, { ...item, children: [], childCount: 0 }));

  const roots: ProjectTreeNode[] = [];
  byId.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId)!;
      parent.children.push(node);
      parent.childCount = parent.children.length;
    } else {
      roots.push(node);
    }
  });

  const sortRecursive = (nodes: ProjectTreeNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    nodes.forEach((n) => sortRecursive(n.children));
  };
  sortRecursive(roots);

  return roots;
}
