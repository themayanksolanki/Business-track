import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges, viewChild, TemplateRef, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import dayjs from 'dayjs/esm';
import { ProjectService } from '../../core/services/project.service';
import {
  ProjectTreeNode,
  MAX_PROJECT_ITEM_DEPTH,
  ProjectItemStatus,
  ProjectItemPriority,
  CompletionRollup,
  computeCompletionRollup,
} from '../../models/project-item.model';
import { ContextMenuComponent, ContextMenuItem } from '../context-menu/context-menu.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { DatePickerComponent } from '../date-picker/date-picker.component';
import { AttachmentPanelComponent } from '../attachment-panel/attachment-panel.component';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../notification.service';
import { AutoGrowDirective } from '../auto-grow.directive';
import { AuthService } from '../../core/services/auth.service';
import { User } from '../../models/user.model';
import { TagPillComponent } from '../tag-pill/tag-pill.component';
import { DropListRegistryService } from '../drop-list-registry.service';

@Component({
  selector: 'app-project-tree-node',
  standalone: true,
  imports: [
    FormsModule,
    DragDropModule,
    ContextMenuComponent,
    ConfirmDialogComponent,
    DatePickerComponent,
    AttachmentPanelComponent,
    ProjectTreeNodeComponent,
    CommonModule,
    AutoGrowDirective,
    TagPillComponent,
  ],
  templateUrl: './project-tree-node.component.html',
  styleUrl: './project-tree-node.component.css',
})
export class ProjectTreeNodeComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) node!: ProjectTreeNode;
  @Input({ required: true }) projectId!: string;
  @Input() users: User[] = [];
  @Input() isFirst = false;
  @Input() isLast = false;
  @Input() selectionMode = false;
  @Input() selectedIds: Set<number> = new Set();
  @Input() expandCommand: { expand: boolean; token: number } | null = null;
  // Role-based permission (Admin/creator/owner/editor-role member = true,
  // a member with a view-only role = false) — distinct from the draft-lock
  // `readOnly` concept elsewhere; this hides every edit affordance on the
  // row entirely rather than disabling it.
  @Input() canEdit = true;

  @Output() refresh = new EventEmitter<void>();
  @Output() openDetail = new EventEmitter<ProjectTreeNode>();
  @Output() toggleSelect = new EventEmitter<number>();
  @Output() moveToGroupRequested = new EventEmitter<ProjectTreeNode>();
  @Output() moveToProjectRequested = new EventEmitter<ProjectTreeNode>();
  @Output() deleted = new EventEmitter<number>();
  // Bubbles to project-detail.component.ts, which has the parent project's
  // organizationId/sequenceId already in scope to build the shareable link.
  @Output() copyTaskLinkRequested = new EventEmitter<ProjectTreeNode>();
  @ViewChild('titleInput') titleInput!: ElementRef<HTMLTextAreaElement>;

  expanded = false;
  attachmentsOpen = false;
  descriptionOpen = false;
  description = '';

  addChildOpen = false;
  addChildTitle = '';
  addChildLoading = false;
  addChildError = '';
  editTitle = false;

  menuVisible = false;
  menuX = 0;
  menuY = 0;

  confirmOpen = false;
  confirmLoading = false;

  readonly statusOptions: ProjectItemStatus[] = ['todo', 'doing', 'completed'];
  readonly priorityOptions: ProjectItemPriority[] = ['low', 'medium', 'high'];

  private brokenAvatarIds = new Set<number>();
  private lastExpandToken = -1;

  constructor(
    private projectService: ProjectService,
    private notifications: NotificationService,
    public auth: AuthService,
    private dropListRegistry: DropListRegistryService
  ) {}

  ngOnInit() {
    this.description = this.node.description;
    // Groups start collapsed except the first one, so the page doesn't open
    // with every group's task list expanded; deeper nodes (tasks, subtasks)
    // keep the old always-expanded default.
    this.expanded = this.node.depth !== 0 || this.isFirst;
    // Deferred: sibling nodes register into the same depth bucket during
    // their own ngOnInit as the parent's @for loop creates them one by one.
    // Registering synchronously here mutates state that an earlier sibling's
    // [cdkDropListConnectedTo] binding already read this same CD pass,
    // triggering NG0100 when Angular's dev-mode re-check catches the
    // now-stale value. Queuing it lets every sibling finish creating first.
    if (this.canAddChild) queueMicrotask(() => this.dropListRegistry.register(this.node.depth + 1, this.dropListId));
  }

  ngOnChanges(changes: SimpleChanges) {
    const change = changes['node'];
    if (change && !change.firstChange) {
      const prevDepth = change.previousValue?.depth;
      if (prevDepth !== this.node.depth) {
        this.dropListRegistry.unregister(prevDepth + 1, this.dropListId);
        if (this.canAddChild)
          queueMicrotask(() => this.dropListRegistry.register(this.node.depth + 1, this.dropListId));
      }
    }

    if (this.expandCommand && this.expandCommand.token !== this.lastExpandToken) {
      this.lastExpandToken = this.expandCommand.token;
      if (this.node.children.length > 0) this.expanded = this.expandCommand.expand;
    }
  }

  ngOnDestroy() {
    this.dropListRegistry.unregister(this.node.depth + 1, this.dropListId);
  }

  get connectedDropLists(): string[] {
    return this.dropListRegistry.idsForDepth(this.node.depth + 1);
  }

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add(user.id);
  }

  visibleTags(node: ProjectTreeNode) {
    return node.tags.slice(0, 3);
  }

  hiddenTagCount(node: ProjectTreeNode): number {
    return Math.max(0, node.tags.length - 3);
  }

  get dropListId(): string {
    return 'drop-' + this.node.id;
  }

  get canAddChild(): boolean {
    return this.node.depth < MAX_PROJECT_ITEM_DEPTH;
  }

  get canMoveUp(): boolean {
    return !this.isFirst;
  }

  get canMoveDown(): boolean {
    return !this.isLast;
  }

  // Indenting makes the previous sibling the new parent, one level deeper —
  // needs a previous sibling to exist, and room left under the depth cap.
  get canIndent(): boolean {
    return !this.isFirst && this.node.depth < MAX_PROJECT_ITEM_DEPTH;
  }

  // Outdenting moves the item up to its parent's level. A task directly
  // under a group (depth 1) has nowhere sensible to go — its parent's level
  // (depth 0) is groups-only — so only subtasks (depth 2+) can outdent.
  get canOutdent(): boolean {
    return this.node.depth > 1;
  }

  get typeIcon(): string {
    if (this.node.type === 'group') return 'bi-folder2';
    if (this.node.type === 'task') return 'bi-check2-square';
    return 'bi-arrow-return-right';
  }

  // Groups (depth 0) hold tasks; tasks/subtasks (depth 1+) hold subtasks.
  get addChildPlaceholder(): string {
    return this.node.depth === 0 ? 'Add task…' : 'Add subtask…';
  }

  get confirmMessage(): string {
    return this.node.childCount > 0
      ? `"${this.node.title}" and all ${this.node.childCount} child item(s) beneath it will be permanently deleted.`
      : `"${this.node.title}" will be permanently deleted.`;
  }

  get statusLabel(): string {
    return this.node.status === 'todo'
      ? 'Todo'
      : this.node.status === 'doing'
        ? 'Doing'
        : 'Completed';
  }

  statusLabelFor(status: ProjectItemStatus): string {
    return status === 'todo'
      ? 'Todo'
      : status === 'doing'
        ? 'Doing'
        : 'Completed';
  }

  get isGroup(): boolean {
    return this.node.type === 'group';
  }

  get canEditStatus(): boolean {
    return !this.isGroup && this.node.childCount === 0 && this.canEdit;
  }

  setStatus(status: ProjectItemStatus) {
    if (!this.canEditStatus || this.node.status === status) return;
    this.projectService
      .updateItem(this.projectId, this.node.id, { status })
      .subscribe({
        next: () => {
          this.node.status = status;
          this.notifications.success(`Status updated to "${this.statusLabelFor(status)}"`);
        },
        error: (err) => {
          this.notifications.error(err.error?.message || 'Failed to update status');
        },
      });
  }

  setPriority(priority: ProjectItemPriority) {
    if (this.node.priority === priority) return;
    this.projectService
      .updateItem(this.projectId, this.node.id, { priority })
      .subscribe({
        next: () => {
          this.node.priority = priority;
          this.notifications.success(`Priority updated to "${priority}"`);
        },
        error: (err) => {
          this.notifications.error(err.error?.message || 'Failed to update priority');
        },
      });
  }

  get rollup(): CompletionRollup | null {
    return this.node.children.length === 0
      ? null
      : computeCompletionRollup(this.node.children);
  }

  get dueValue(): string | null {
    return this.node.endDate
      ? dayjs(this.node.endDate).format('YYYY-MM-DD')
      : null;
  }

  setDue(date: string | null) {
    const endDate = date ? dayjs(date, 'YYYY-MM-DD').toISOString() : null;
    this.projectService
      .updateItem(this.projectId, this.node.id, { endDate })
      .subscribe({
        next: () => {
          this.node.endDate = endDate;
          this.notifications.success('Due date updated');
        },
        error: (err) => {
          this.notifications.error(err.error?.message || 'Failed to update due date');
        },
      });
  }

  // Copying a link is read-adjacent (like "View Details"), not a mutation —
  // available regardless of canEdit. Groups aren't "tasks", and a legacy
  // item with no sequenceId has nothing stable to build a link from.
  private get copyTaskLinkMenuItem(): ContextMenuItem[] {
    return this.node.type !== 'group' && this.node.sequenceId
      ? [{ label: 'Copy Task Link', icon: 'bi-link-45deg', action: 'copy-task-link' }]
      : [];
  }

  get menuItems(): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    // View-only users only ever get "View Details" (+ copy link) —
    // everything else here is a mutation (add/move/duplicate/delete).
    if (!this.canEdit) {
      items.push({ label: 'View Details', icon: 'bi-eye', action: 'view' }, ...this.copyTaskLinkMenuItem);
      return items;
    }
    if (this.canAddChild)
      items.push({
        label: 'Add Child',
        icon: 'bi-plus-lg',
        action: 'add-child',
      });
    items.push({ label: 'View Details', icon: 'bi-eye', action: 'view' });
    items.push(...this.copyTaskLinkMenuItem);
    if (this.node.type === 'task')
      items.push({
        label: 'Move to Group',
        icon: 'bi-folder-symlink',
        action: 'move-to-group',
      });
    items.push({
      label: 'Move to Project',
      icon: 'bi-send',
      action: 'move-to-project',
    });
    items.push({
      label: 'Duplicate',
      icon: 'bi-copy',
      action: 'duplicate',
    });
    items.push({
      label: 'Delete',
      icon: 'bi-trash3',
      action: 'delete',
      danger: true,
    });
    return items;
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  selectAssignee(user: User | null) {
    if (this.isGroup) return;
    const assignedTo = user ? user.id ?? user.id ?? null : null;
    this.projectService.updateItem(this.projectId, this.node.id, { assignedTo }).subscribe({
      next: (res) => {
        this.node.assignedTo = res.item.assignedTo;
        this.notifications.success(user ? `Reassigned to ${user.username}` : 'Task unassigned');
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to reassign task');
      },
    });
  }

  toggleExpand() {
    if (this.node.children.length === 0) return;
    this.expanded = !this.expanded;
  }

  toggleAttachments() {
    if (this.isGroup) return;
    this.attachmentsOpen = !this.attachmentsOpen;
  }

  toggleDescription() {
    if (this.isGroup) return;
    this.descriptionOpen = !this.descriptionOpen;
  }

  saveDescription() {
    if (this.description === this.node.description) return;
    this.projectService
      .updateItem(this.projectId, this.node.id, { description: this.description })
      .subscribe({
        next: () => {
          this.node.description = this.description;
        },
        error: (err) => {
          this.notifications.error(err.error?.message || 'Failed to update description');
        },
      });
  }

  async onTitleClick() {
    this.editTitle = !this.editTitle;
    if (this.editTitle) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.titleInput?.nativeElement.focus();
    }
  }

  openContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.menuX = event.clientX;
    this.menuY = event.clientY;
    this.menuVisible = true;
  }

  onMenuAction(action: string) {
    if (action === 'add-child') this.openAddChild();
    else if (action === 'view') this.openDetail.emit(this.node);
    else if (action === 'copy-task-link') this.copyTaskLinkRequested.emit(this.node);
    else if (action === 'move-to-group') this.moveToGroupRequested.emit(this.node);
    else if (action === 'move-to-project') this.moveToProjectRequested.emit(this.node);
    else if (action === 'duplicate') this.duplicate();
    else if (action === 'delete') this.confirmOpen = true;
  }

  duplicate() {
    this.projectService.duplicateItem(this.projectId, this.node.id).subscribe({
      next: () => {
        this.notifications.success(`"${this.node.title}" duplicated`);
        this.refresh.emit();
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to duplicate item');
      },
    });
  }

  openAddChild() {
    if (!this.canAddChild) return;
    this.addChildOpen = true;
    this.addChildTitle = '';
    this.addChildError = '';
    this.expanded = true;
  }

  cancelAddChild() {
    this.addChildOpen = false;
    this.addChildError = '';
  }

  onAddChildKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    this.submitAddChild();
  }

  submitAddChild() {
    const title = this.addChildTitle.trim();
    if (!title) return;
    this.addChildLoading = true;
    this.addChildError = '';
    this.projectService
      .createItem(this.projectId, { title, parentId: this.node.id })
      .subscribe({
        next: (res) => {
          this.addChildLoading = false;
          this.addChildOpen = false;
          this.node.children = [...this.node.children, { ...res.item, children: [], childCount: 0 }];
          this.node.childCount = this.node.children.length;
        },
        error: (err) => {
          this.addChildError = err.error?.message || 'Failed to add item';
          this.addChildLoading = false;
        },
      });
  }

  confirmDelete() {
    this.confirmLoading = true;
    this.projectService.deleteItem(this.projectId, this.node.id).subscribe({
      next: () => {
        this.confirmLoading = false;
        this.confirmOpen = false;
        this.deleted.emit(this.node.id);
      },
      error: () => {
        this.confirmLoading = false;
        this.confirmOpen = false;
      },
    });
  }

  private move(direction: 'up' | 'down' | 'indent' | 'outdent') {
    this.projectService.moveItem(this.projectId, this.node.id, direction).subscribe({
      next: () => this.refresh.emit(),
      error: (err) => this.notifications.error(err.error?.message || 'Failed to move item'),
    });
  }

  moveUp() {
    if (!this.canMoveUp) return;
    this.move('up');
  }

  moveDown() {
    if (!this.canMoveDown) return;
    this.move('down');
  }

  indent() {
    if (!this.canIndent) return;
    this.move('indent');
  }

  outdent() {
    if (!this.canOutdent) return;
    this.move('outdent');
  }

  onDrop(event: CdkDragDrop<ProjectTreeNode[]>) {
    if (event.previousContainer === event.container) {
      if (event.previousIndex === event.currentIndex) return;
      moveItemInArray(
        this.node.children,
        event.previousIndex,
        event.currentIndex,
      );
      const orderedIds = this.node.children.map((c) => c.id);
      this.projectService
        .reorderItems(this.projectId, this.node.id, orderedIds)
        .subscribe({
          error: () => this.refresh.emit(),
        });
      return;
    }

    const movedItem = event.previousContainer.data[event.previousIndex];
    transferArrayItem(
      event.previousContainer.data,
      event.container.data,
      event.previousIndex,
      event.currentIndex,
    );
    this.projectService
      .moveItemToParent(this.projectId, movedItem.id, this.node.id, event.currentIndex)
      .subscribe({
        next: () => this.refresh.emit(),
        error: (err) => {
          this.notifications.error(err.error?.message || 'Failed to move item');
          this.refresh.emit();
        },
      });
  }

  onTitleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    this.saveTitle();
  }

  saveTitle() {
    const newTitle = (this.titleInput?.nativeElement.value || '').trim();
    if (!newTitle || newTitle === this.node.title) {
      this.editTitle = false;
      return;
    }
    this.projectService
      .updateItem(this.projectId, this.node.id, { title: newTitle })
      .subscribe({
        next: () => {
          this.node.title = newTitle;
          this.editTitle = false;
          this.notifications.success('Title updated');
        },
        error: (err) => {
          this.editTitle = false;
          this.notifications.error(err.error?.message || 'Failed to update title');
        },
      });
  }
}
