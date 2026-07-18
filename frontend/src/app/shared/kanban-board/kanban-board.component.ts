import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  DragDropModule,
  CdkDragDrop,
  transferArrayItem,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ProjectService } from '../../core/services/project.service';
import {
  ProjectTreeNode,
  ProjectItemStatus,
  ProjectItemPriority,
  ProjectItemSummary,
  CreateProjectItemPayload,
  flattenLeaves,
} from '../../models/project-item.model';
import { User } from '../../models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { TagPillComponent } from '../tag-pill/tag-pill.component';

export type KanbanGroupMode = 'status' | 'assignee' | 'priority';

interface KanbanColumn {
  id: string;
  label: string;
  icon: string;
  colorClass: string;
  items: ProjectTreeNode[];
}

const STATUS_DEFS: { value: ProjectItemStatus; label: string; icon: string; colorClass: string }[] = [
  { value: 'todo', label: 'Todo', icon: 'bi-circle', colorClass: 'col-todo' },
  { value: 'doing', label: 'Doing', icon: 'bi-arrow-repeat', colorClass: 'col-doing' },
  { value: 'completed', label: 'Completed', icon: 'bi-check-circle-fill', colorClass: 'col-completed' },
];

const PRIORITY_DEFS: { value: ProjectItemPriority; label: string; icon: string; colorClass: string }[] = [
  { value: 'low', label: 'Low', icon: 'bi-flag-fill', colorClass: 'col-low' },
  { value: 'medium', label: 'Medium', icon: 'bi-flag-fill', colorClass: 'col-medium' },
  { value: 'high', label: 'High', icon: 'bi-flag-fill', colorClass: 'col-high' },
];

@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [DragDropModule, DatePipe, FormsModule, TagPillComponent],
  templateUrl: './kanban-board.component.html',
  styleUrl: './kanban-board.component.css',
})
export class KanbanBoardComponent implements OnChanges, OnDestroy {
  @Input() tree: ProjectTreeNode[] = [];
  @Input({ required: true }) projectId!: string;
  @Input() users: User[] = [];
  @Input() itemSummary: Record<string, ProjectItemSummary> = {};

  @Output() refresh = new EventEmitter<void>();
  @Output() openDetail = new EventEmitter<ProjectTreeNode>();

  groupMode: KanbanGroupMode = 'status';
  columns: KanbanColumn[] = [];

  readonly connectedIds: string[] = [];

  coverUrls = new Map<number, string>();
  private loadingCovers = new Set<number>();

  addingColumnId: string | null = null;
  newItemTitle = '';
  addLoading = false;
  addError = '';

  private brokenAvatarIds = new Set<number>();

  constructor(private projectService: ProjectService, public auth: AuthService) {}

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add(user.id);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['tree'] || changes['users']) this.rebuildColumns();
    if (changes['itemSummary']) this.syncCovers(flattenLeaves(this.tree));
  }

  ngOnDestroy() {
    for (const url of this.coverUrls.values()) URL.revokeObjectURL(url);
  }

  setGroupMode(mode: KanbanGroupMode) {
    if (this.groupMode === mode) return;
    this.groupMode = mode;
    this.cancelAdd();
    this.rebuildColumns();
  }

  private userId(user: User | null | undefined): number | null {
    if (!user) return null;
    return user.id;
  }

  private rebuildColumns() {
    const leaves = flattenLeaves(this.tree);

    if (this.groupMode === 'status') {
      this.columns = STATUS_DEFS.map((def) => ({
        id: 'kb-status-' + def.value,
        label: def.label,
        icon: def.icon,
        colorClass: def.colorClass,
        items: leaves.filter((i) => i.status === def.value),
      }));
    } else if (this.groupMode === 'priority') {
      this.columns = PRIORITY_DEFS.map((def) => ({
        id: 'kb-priority-' + def.value,
        label: def.label,
        icon: def.icon,
        colorClass: def.colorClass,
        items: leaves.filter((i) => i.priority === def.value),
      }));
    } else {
      const cols: KanbanColumn[] = [
        {
          id: 'kb-assignee-unassigned',
          label: 'Unassigned',
          icon: 'bi-person',
          colorClass: 'col-unassigned',
          items: leaves.filter((i) => !i.assignedTo),
        },
      ];
      for (const u of this.users) {
        const uid = this.userId(u);
        if (!uid) continue;
        cols.push({
          id: 'kb-assignee-' + uid,
          label: u.username,
          icon: 'bi-person-fill',
          colorClass: 'col-user',
          items: leaves.filter((i) => this.userId(i.assignedTo) === uid),
        });
      }
      this.columns = cols;
    }

    this.connectedIds.length = 0;
    this.connectedIds.push(...this.columns.map((c) => c.id));
    this.syncCovers(leaves);
  }

  private syncCovers(leaves: ProjectTreeNode[]) {
    for (const node of leaves) {
      const cover = this.itemSummary[node.id]?.cover;
      if (!cover || this.coverUrls.has(node.id) || this.loadingCovers.has(node.id)) continue;

      this.loadingCovers.add(node.id);
      this.projectService.downloadAttachment(this.projectId, node.id, cover.attachmentId).subscribe({
        next: (blob) => {
          this.coverUrls.set(node.id, URL.createObjectURL(blob));
          this.loadingCovers.delete(node.id);
        },
        error: () => this.loadingCovers.delete(node.id),
      });
    }
  }

  commentCount(node: ProjectTreeNode): number {
    return this.itemSummary[node.id]?.commentCount ?? 0;
  }

  dateRangeLabel(node: ProjectTreeNode): string {
    const start = node.startDate ? new Date(node.startDate) : null;
    const end = node.endDate ? new Date(node.endDate) : null;
    if (!start && !end) return '';

    const withMonth = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dayOnly = (d: Date) => String(d.getDate());

    if (start && end) {
      const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
      return sameMonth ? `${withMonth(start)} - ${dayOnly(end)}` : `${withMonth(start)} - ${withMonth(end)}`;
    }
    return withMonth((start ?? end)!);
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  statusColorClass(status: ProjectItemStatus): string {
    return 'badge-' + status;
  }

  priorityColorClass(priority: ProjectItemPriority): string {
    return 'priority-' + priority;
  }

  visibleTags(node: ProjectTreeNode) {
    return node.tags.slice(0, 2);
  }

  hiddenTagCount(node: ProjectTreeNode): number {
    return Math.max(0, node.tags.length - 2);
  }

  onCardClick(node: ProjectTreeNode) {
    this.openDetail.emit(node);
  }

  selectAssignee(node: ProjectTreeNode, user: User | null) {
    const assignedTo = user ? this.userId(user) : null;
    if (this.userId(node.assignedTo) === assignedTo) return;
    node.assignedTo = user ?? null;
    if (this.groupMode === 'assignee') this.rebuildColumns();
    this.projectService.updateItem(this.projectId, node.id, { assignedTo }).subscribe({
      next: () => this.refresh.emit(),
      error: () => this.refresh.emit(),
    });
  }

  drop(event: CdkDragDrop<ProjectTreeNode[]>, column: KanbanColumn) {
    if (event.previousContainer === event.container) {
      if (event.previousIndex === event.currentIndex) return;
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      return;
    }

    const node = event.previousContainer.data[event.previousIndex];
    transferArrayItem(event.previousContainer.data, event.container.data, event.previousIndex, event.currentIndex);
    this.applyColumnValue(node, column);
  }

  private applyColumnValue(node: ProjectTreeNode, column: KanbanColumn) {
    let payload: { status?: ProjectItemStatus; priority?: ProjectItemPriority; assignedTo?: number | null };

    if (this.groupMode === 'status') {
      const value = column.id.replace('kb-status-', '') as ProjectItemStatus;
      if (node.status === value) return;
      payload = { status: value };
      node.status = value;
    } else if (this.groupMode === 'priority') {
      const value = column.id.replace('kb-priority-', '') as ProjectItemPriority;
      if (node.priority === value) return;
      payload = { priority: value };
      node.priority = value;
    } else {
      const raw = column.id.replace('kb-assignee-', '');
      const assignedTo = raw === 'unassigned' ? null : Number(raw);
      if (this.userId(node.assignedTo) === assignedTo) return;
      payload = { assignedTo };
      node.assignedTo = assignedTo ? this.users.find((u) => this.userId(u) === assignedTo) ?? null : null;
    }

    this.projectService.updateItem(this.projectId, node.id, payload).subscribe({
      next: () => this.refresh.emit(),
      error: () => this.refresh.emit(),
    });
  }

  // ── Quick-add (bottom of column) ──
  // New items are created directly under the project's first group, since
  // Kanban only ever shows leaf tasks/subtasks — a root-level item created
  // without a parent would be a group itself and wouldn't appear on the board.
  get hasGroups(): boolean {
    return this.tree.length > 0;
  }

  startAdd(column: KanbanColumn) {
    if (!this.hasGroups) return;
    this.addingColumnId = column.id;
    this.newItemTitle = '';
    this.addError = '';
  }

  cancelAdd() {
    this.addingColumnId = null;
    this.newItemTitle = '';
    this.addError = '';
  }

  onAddKeydown(event: KeyboardEvent, column: KanbanColumn) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.submitAdd(column);
    } else if (event.key === 'Escape') {
      this.cancelAdd();
    }
  }

  submitAdd(column: KanbanColumn) {
    if (this.addLoading) return;
    const title = this.newItemTitle.trim();
    if (!title || !this.hasGroups) return;

    const payload: CreateProjectItemPayload = { title, parentId: this.tree[0].id };
    if (this.groupMode === 'priority') {
      payload.priority = column.id.replace('kb-priority-', '') as ProjectItemPriority;
    } else if (this.groupMode === 'assignee') {
      const raw = column.id.replace('kb-assignee-', '');
      payload.assignedTo = raw === 'unassigned' ? null : Number(raw);
    }

    this.addLoading = true;
    this.addError = '';
    this.projectService.createItem(this.projectId, payload).subscribe({
      next: (res) => {
        this.addLoading = false;
        this.cancelAdd();

        if (this.groupMode === 'status') {
          const status = column.id.replace('kb-status-', '') as ProjectItemStatus;
          if (status !== 'todo') {
            this.projectService.updateItem(this.projectId, res.item.id, { status }).subscribe({
              next: () => this.refresh.emit(),
              error: () => this.refresh.emit(),
            });
            return;
          }
        }
        this.refresh.emit();
      },
      error: (err) => {
        this.addLoading = false;
        this.addError = err.error?.message || 'Failed to add task';
      },
    });
  }
}
