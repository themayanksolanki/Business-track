import { User } from './user.model';

export type ProjectItemType = 'group' | 'task' | 'subtask';
export type ProjectItemStatus = 'todo' | 'doing' | 'completed';
export type ProjectItemPriority = 'low' | 'medium' | 'high';

export const MAX_PROJECT_ITEM_DEPTH = 4; // depths 0-4 => 5 levels total

export interface ProjectItem {
  _id: string;
  project: string;
  parentId: string | null;
  type: ProjectItemType;
  title: string;
  description: string;
  status: ProjectItemStatus;
  priority: ProjectItemPriority;
  assignedTo: User | null;
  createdBy: User;
  depth: number;
  order: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectItemPayload {
  title: string;
  description?: string;
  priority?: ProjectItemPriority;
  assignedTo?: string | null;
  parentId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateProjectItemPayload {
  title?: string;
  description?: string;
  priority?: ProjectItemPriority;
  assignedTo?: string | null;
  status?: ProjectItemStatus;
  startDate?: string | null;
  endDate?: string | null;
}

// Frontend-only: recursive tree built client-side from the flat ProjectItem[] response.
export interface ProjectTreeNode extends ProjectItem {
  children: ProjectTreeNode[];
  childCount: number;
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
  const byId = new Map<string, ProjectTreeNode>();
  items.forEach((item) => byId.set(item._id, { ...item, children: [], childCount: 0 }));

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
