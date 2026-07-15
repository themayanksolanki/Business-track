import { Component, Input, Output, EventEmitter, viewChild, TemplateRef, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import moment from 'moment';
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
  ],
  templateUrl: './project-tree-node.component.html',
  styleUrl: './project-tree-node.component.css',
})
export class ProjectTreeNodeComponent {
  @Input({ required: true }) node!: ProjectTreeNode;
  @Input({ required: true }) projectId!: string;

  @Output() refresh = new EventEmitter<void>();
  @Output() openDetail = new EventEmitter<ProjectTreeNode>();
  @ViewChild('titleInput') titleInput!: ElementRef<HTMLInputElement>;

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

  constructor(private projectService: ProjectService) {}

  get dropListId(): string {
    return 'drop-' + this.node._id;
  }

  get canAddChild(): boolean {
    return this.node.depth < MAX_PROJECT_ITEM_DEPTH;
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

  get canEditStatus(): boolean {
    return this.node.childCount === 0;
  }

  setStatus(status: ProjectItemStatus) {
    if (!this.canEditStatus || this.node.status === status) return;
    this.projectService
      .updateItem(this.projectId, this.node._id, { status })
      .subscribe({
        next: () => this.refresh.emit(),
      });
  }

  setPriority(priority: ProjectItemPriority) {
    if (this.node.priority === priority) return;
    this.projectService
      .updateItem(this.projectId, this.node._id, { priority })
      .subscribe({
        next: () => this.refresh.emit(),
      });
  }

  get rollup(): CompletionRollup | null {
    return this.node.children.length === 0
      ? null
      : computeCompletionRollup(this.node.children);
  }

  get dueValue(): string | null {
    return this.node.endDate
      ? moment(this.node.endDate).format('YYYY-MM-DD')
      : null;
  }

  setDue(date: string | null) {
    const endDate = date ? moment(date, 'YYYY-MM-DD').toISOString() : null;
    this.projectService
      .updateItem(this.projectId, this.node._id, { endDate })
      .subscribe({
        next: () => this.refresh.emit(),
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

  saveTitle() {
    const newTitle = this.titleInput?.nativeElement.value || '';
    if (!newTitle.trim() || newTitle === this.node.title) {
      this.editTitle = false;
      return;
    }
    this.projectService
      .updateItem(this.projectId, this.node._id, { title: newTitle.trim() })
      .subscribe({
        next: () => {
          this.editTitle = false;
          this.refresh.emit();
        },
        error: () => {
          this.editTitle = false;
        },
      });
  }
}
