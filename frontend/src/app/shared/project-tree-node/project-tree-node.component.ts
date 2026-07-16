import { Component, Input, Output, EventEmitter, viewChild, TemplateRef, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
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
  ],
  templateUrl: './project-tree-node.component.html',
  styleUrl: './project-tree-node.component.css',
})
export class ProjectTreeNodeComponent {
  @Input({ required: true }) node!: ProjectTreeNode;
  @Input({ required: true }) projectId!: string;
  @Input() isFirst = false;
  @Input() isLast = false;

  @Output() refresh = new EventEmitter<void>();
  @Output() openDetail = new EventEmitter<ProjectTreeNode>();
  @ViewChild('titleInput') titleInput!: ElementRef<HTMLTextAreaElement>;

  expanded = true;
  attachmentsOpen = false;

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

  constructor(
    private projectService: ProjectService,
    private notifications: NotificationService
  ) {}

  get dropListId(): string {
    return 'drop-' + this.node._id;
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

  // Outdenting moves the item up to its parent's level — only possible if
  // it has a parent to begin with.
  get canOutdent(): boolean {
    return this.node.depth > 0;
  }

  get typeIcon(): string {
    if (this.node.type === 'group') return 'bi-folder2';
    if (this.node.type === 'task') return 'bi-check2-square';
    return 'bi-arrow-return-right';
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
    return !this.isGroup && this.node.childCount === 0;
  }

  setStatus(status: ProjectItemStatus) {
    if (!this.canEditStatus || this.node.status === status) return;
    this.projectService
      .updateItem(this.projectId, this.node._id, { status })
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
      .updateItem(this.projectId, this.node._id, { priority })
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
      .updateItem(this.projectId, this.node._id, { endDate })
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

  get menuItems(): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (this.canAddChild)
      items.push({
        label: 'Add Child',
        icon: 'bi-plus-lg',
        action: 'add-child',
      });
    items.push({ label: 'View Details', icon: 'bi-eye', action: 'view' });
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

  toggleExpand() {
    if (this.node.children.length === 0) return;
    this.expanded = !this.expanded;
  }

  toggleAttachments() {
    if (this.isGroup) return;
    this.attachmentsOpen = !this.attachmentsOpen;
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
    else if (action === 'delete') this.confirmOpen = true;
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
      .createItem(this.projectId, { title, parentId: this.node._id })
      .subscribe({
        next: () => {
          this.addChildLoading = false;
          this.addChildOpen = false;
          this.refresh.emit();
        },
        error: (err) => {
          this.addChildError = err.error?.message || 'Failed to add item';
          this.addChildLoading = false;
        },
      });
  }

  confirmDelete() {
    this.confirmLoading = true;
    this.projectService.deleteItem(this.projectId, this.node._id).subscribe({
      next: () => {
        this.confirmLoading = false;
        this.confirmOpen = false;
        this.refresh.emit();
      },
      error: () => {
        this.confirmLoading = false;
        this.confirmOpen = false;
      },
    });
  }

  private move(direction: 'up' | 'down' | 'indent' | 'outdent') {
    this.projectService.moveItem(this.projectId, this.node._id, direction).subscribe({
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
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(
      this.node.children,
      event.previousIndex,
      event.currentIndex,
    );
    const orderedIds = this.node.children.map((c) => c._id);
    this.projectService
      .reorderItems(this.projectId, this.node._id, orderedIds)
      .subscribe({
        error: () => this.refresh.emit(),
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
      .updateItem(this.projectId, this.node._id, { title: newTitle })
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
