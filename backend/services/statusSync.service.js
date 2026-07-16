import ProjectItem from '../models/ProjectItem.js';

export const MAX_DEPTH = 4; // depths 0-4 => 5 levels total

export const typeForDepth = (depth) => (depth === 0 ? 'group' : depth === 1 ? 'task' : 'subtask');

export async function recomputeAncestorStatuses(parentId) {
  if (!parentId) return;

  const parent = await ProjectItem.findById(parentId);
  if (!parent) return;
  if (parent.type === 'group') return; // groups don't carry a status

  const children = await ProjectItem.find({ parentId: parent._id });
  if (children.length === 0) return;

  const computed = children.every((c) => c.status === 'completed')
    ? 'completed'
    : children.some((c) => c.status === 'doing' || c.status === 'completed')
    ? 'doing'
    : 'todo';

  if (computed !== parent.status) {
    parent.status = computed;
    await parent.save();
    await recomputeAncestorStatuses(parent.parentId);
  }
}
