import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  DragDropModule,
  CdkDragDrop,
  transferArrayItem,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ProjectService } from '../../core/services/project.service';
import { ProjectTreeNode, ProjectItemStatus, ProjectItemPriority, flattenLeaves } from '../../models/project-item.model';
import { User } from '../../models/user.model';

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
  imports: [DragDropModule, DatePipe],
  templateUrl: './kanban-board.component.html',
  styleUrl: './kanban-board.component.css',
})
export class KanbanBoardComponent implements OnChanges {
  @Input() tree: ProjectTreeNode[] = [];
  @Input({ required: true }) projectId!: string;
  @Input() users: User[] = [];

  @Output() refresh = new EventEmitter<void>();
  @Output() openDetail = new EventEmitter<ProjectTreeNode>();

  groupMode: KanbanGroupMode = 'status';
  columns: KanbanColumn[] = [];

  readonly connectedIds: string[] = [];

  constructor(private projectService: ProjectService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['tree'] || changes['users']) this.rebuildColumns();
  }

  setGroupMode(mode: KanbanGroupMode) {
    if (this.groupMode === mode) return;
    this.groupMode = mode;
    this.rebuildColumns();
  }

  private userId(user: User | null | undefined): string | null {
    if (!user) return null;
    return user._id ?? user.id ?? null;
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

  onCardClick(node: ProjectTreeNode) {
    this.openDetail.emit(node);
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
    let payload: { status?: ProjectItemStatus; priority?: ProjectItemPriority; assignedTo?: string | null };

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
      const assignedTo = raw === 'unassigned' ? null : raw;
      if (this.userId(node.assignedTo) === assignedTo) return;
      payload = { assignedTo };
      node.assignedTo = assignedTo ? this.users.find((u) => this.userId(u) === assignedTo) ?? null : null;
    }

    this.projectService.updateItem(this.projectId, node._id, payload).subscribe({
      next: () => this.refresh.emit(),
      error: () => this.refresh.emit(),
    });
  }
}
