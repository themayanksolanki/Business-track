import { Injectable } from '@angular/core';

// Lets sibling tree-node instances discover each other's cdkDropList ids so
// lists can be connected across parents (e.g. dragging a task from one group
// into another). Keyed by the depth of the *children* a list holds, since
// every list at a given depth always holds the same item type (group/task/
// subtask) and can safely accept drops from any other list at that depth.
// Scoped per project-detail view via component-level providers.
@Injectable()
export class DropListRegistryService {
  private byDepth = new Map<number, Set<string>>();

  register(depth: number, id: string): void {
    let ids = this.byDepth.get(depth);
    if (!ids) {
      ids = new Set<string>();
      this.byDepth.set(depth, ids);
    }
    ids.add(id);
  }

  unregister(depth: number, id: string): void {
    this.byDepth.get(depth)?.delete(id);
  }

  idsForDepth(depth: number): string[] {
    const ids = this.byDepth.get(depth);
    return ids ? Array.from(ids) : [];
  }
}
