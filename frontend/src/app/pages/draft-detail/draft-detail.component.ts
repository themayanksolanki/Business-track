import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin } from 'rxjs';
import { CKEditorModule } from '@ckeditor/ckeditor5-angular';
import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Heading,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link,
  List,
  BlockQuote,
  Indent,
  IndentBlock,
} from 'ckeditor5';
import { environment } from '../../../environments/environment';
import { ProjectService } from '../../core/services/project.service';
import { UserService } from '../../core/services/user.service';
import { DepartmentService } from '../../core/services/department.service';
import { Project, ProjectPriority, ProjectEffort, ProjectMember, ProjectDetailsLayoutEntry } from '../../models/project.model';
import { User } from '../../models/user.model';
import { Department } from '../../models/department.model';
import { Category } from '../../models/category.model';
import { CategoryService } from '../../core/services/category.service';
import { ProjectItem, ProjectTreeNode, CompletionRollup, ProjectItemSummary, buildProjectTree, computeCompletionRollup } from '../../models/project-item.model';
import { TabStripComponent, TabDef } from '../../shared/tab-strip/tab-strip.component';
import { ProjectTreeNodeComponent } from '../../shared/project-tree-node/project-tree-node.component';
import { ProjectItemDetailComponent } from '../../shared/project-item-detail/project-item-detail.component';
import { KanbanBoardComponent } from '../../shared/kanban-board/kanban-board.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { AutoGrowDirective } from '../../shared/auto-grow.directive';
import { AuthService } from '../../core/services/auth.service';
import { ProjectAttachmentsCardComponent } from '../../shared/project-attachments-card/project-attachments-card.component';
import { TagService } from '../../core/services/tag.service';
import { Tag, TagLite } from '../../models/tag.model';
import { TagPickerComponent } from '../../shared/tag-picker/tag-picker.component';
import { DropListRegistryService } from '../../shared/drop-list-registry.service';
import { NotificationService } from '../../shared/notification.service';
import { MoveToGroupDialogComponent } from '../../shared/move-to-group-dialog/move-to-group-dialog.component';
import { HelpTipComponent } from '../../shared/help-tip/help-tip.component';
import { NgbPopover, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { ProjectTeamsComponent } from '../../shared/project-teams/project-teams.component';
import { CardResizeDirective, CardResizeEvent } from '../../shared/card-resize.directive';

// Kept separate from ProjectDetailComponent (not a mode-flag on the same
// component), reusing the same lower-level shared children as-is — none of
// them read project.status, so composing them here is identical to how
// ProjectDetailComponent does it. The differences are all in this shell:
// no dates (a draft never has one), no plan/links cards (not part of the
// requested feature set), a static "Draft" badge + one-way "Approve &
// Convert to Project" action instead of the status dropdown, and
// [readOnly]="true" passed to app-project-item-detail so task status stays
// locked to 'todo' and item dates are shown but disabled.
@Component({
  selector: 'app-draft-detail',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    DragDropModule,
    TabStripComponent,
    ProjectTreeNodeComponent,
    ProjectItemDetailComponent,
    KanbanBoardComponent,
    ConfirmDialogComponent,
    AutoGrowDirective,
    ProjectAttachmentsCardComponent,
    TagPickerComponent,
    CKEditorModule,
    MoveToGroupDialogComponent,
    HelpTipComponent,
    NgbTooltip,
    ProjectTeamsComponent,
    CardResizeDirective,
    NgbPopover
  ],
  providers: [DropListRegistryService],
  templateUrl: './draft-detail.component.html',
  styleUrl: './draft-detail.component.css',
})
export class DraftDetailComponent implements OnInit {
  projectId = '';
  project: Project | null = null;
  loading = false;
  error = '';
  approving = false;
  approveError = '';

  tabs: TabDef[] = [
    { key: 'detail', label: 'Details', icon: 'bi-info-circle' },
    { key: 'tasks', label: 'Tasks', icon: 'bi-list-task' },
    { key: 'kanban', label: 'Kanban', icon: 'bi-kanban' },
    { key: 'teams', label: 'Teams', icon: 'bi-people' },
  ];
  activeTab = 'tasks';

  tree: ProjectTreeNode[] = [];
  itemsLoading = false;
  itemSummary: Record<string, ProjectItemSummary> = {};

  addGroupOpen = false;
  addGroupTitle = '';
  addGroupLoading = false;
  addGroupError = '';

  selectedNode: ProjectTreeNode | null = null;

  selectionMode = false;
  selectedIds = new Set<number>();

  expandCommand: { expand: boolean; token: number } | null = null;
  private expandToken = 0;

  moveGroupOpen = false;
  moveGroupMode: 'single' | 'bulk' = 'single';
  moveGroupLoading = false;
  moveGroupTargetNode: ProjectTreeNode | null = null;

  bulkDeleteConfirmOpen = false;
  bulkDeleteLoading = false;

  editName = '';
  editDescription = '';

  deleteConfirmOpen = false;
  deleteLoading = false;

  get departments(): Department[] {
    return this.departmentService.departments();
  }

  get categories(): Category[] {
    return this.categoryService.categories();
  }

  readonly priorityOptions: ProjectPriority[] = ['low', 'medium', 'high'];
  readonly effortOptions: ProjectEffort[] = ['low', 'medium', 'high'];

  detailsText = '';

  readonly DetailsEditor = ClassicEditor;
  readonly detailsEditorConfig = {
    licenseKey: environment.ckeditorLicenseKey,
    plugins: [Essentials, Paragraph, Heading, Bold, Italic, Underline, Strikethrough, Link, List, BlockQuote, Indent, IndentBlock],
    toolbar: [
      'heading', '|',
      'bold', 'italic', 'underline', 'strikethrough', '|',
      'bulletedList', 'numberedList', '|',
      'outdent', 'indent', '|',
      'link', 'blockQuote', '|',
      'undo', 'redo',
    ],
  };

  // Details-tab card layout (order + resize) — same mechanism as
  // ProjectDetailComponent, just a smaller card set (no dates/plan/links).
  readonly DEFAULT_DETAIL_CARD_IDS = ['details', 'attachments', 'priority', 'effort'];
  detailsLayoutEntries: ProjectDetailsLayoutEntry[] = [];

  get allTags(): Tag[] {
    return this.tagService.tags();
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private projectService: ProjectService,
    private userService: UserService,
    private departmentService: DepartmentService,
    private categoryService: CategoryService,
    private tagService: TagService,
    private notifications: NotificationService,
    public auth: AuthService,
  ) {}

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('id') || '';
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'detail' || tab === 'tasks' || tab === 'kanban' || tab === 'teams') this.activeTab = tab;
    this.loadProject();
    this.loadItems();
    this.userService.ensureUsersLoaded();
    this.departmentService.ensureDepartmentsLoaded();
    this.categoryService.ensureCategoriesLoaded();
    this.tagService.ensureTagsLoaded();
  }

  selectTags(tags: TagLite[]) {
    if (!this.project) return;
    this.projectService
      .updateProject(this.projectId, { tags: tags.map((t) => t.id) })
      .subscribe({
        next: (res) => (this.project = res.project),
      });
  }

  get progress(): CompletionRollup {
    return computeCompletionRollup(this.tree);
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  // Mirrors the backend's canManageProjectSettings check — gates the Teams
  // tab's Add/change-role/remove actions, same as a regular project.
  get canManageMembers(): boolean {
    const user = this.auth.getUser();
    if (!user || !this.project) return false;
    if (user.role === 'Admin' || user.role === 'Manager') return true;
    const createdById = this.project.createdBy?.id;
    const ownerId = this.project.owner?.id;
    return createdById === user.id || ownerId === user.id;
  }

  // Mirrors the backend's canApproveDraft check exactly (projectController.js)
  // — narrower than canManageMembers/canManageProjectSettings, since approving
  // a draft is reserved for an Admin or the person who drafted it, not any
  // Manager/owner.
  get canApproveDraft(): boolean {
    const user = this.auth.getUser();
    if (!user || !this.project) return false;
    return user.role === 'Admin' || this.project.createdBy?.id === user.id;
  }

  approveDraft() {
    if (!this.project || this.approving) return;
    this.approving = true;
    this.approveError = '';
    this.projectService.updateProject(this.projectId, { status: 'active' }).subscribe({
      next: () => {
        this.approving = false;
        this.router.navigate(['/projects', this.projectId]);
      },
      error: (err) => {
        this.approveError = err.error?.message || 'Failed to approve draft';
        this.approving = false;
      },
    });
  }

  onMembersChanged(members: ProjectMember[]) {
    if (this.project) this.project = { ...this.project, members };
  }

  get users(): User[] {
    return this.userService.users();
  }

  get memberUsers(): User[] {
    return this.project?.members.map((m) => m.user) ?? [];
  }

  private brokenAvatarIds = new Set<number>();

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add(user.id);
  }

  selectOwner(user: User | null) {
    if (!this.project) return;
    const owner = user ? user.id : null;
    this.projectService.updateProject(this.projectId, { owner }).subscribe({
      next: (res) => (this.project = res.project),
    });
  }

  setPriority(priority: ProjectPriority) {
    if (!this.project || this.project.priority === priority) return;
    this.projectService.updateProject(this.projectId, { priority }).subscribe({
      next: (res) => (this.project = res.project),
    });
  }

  get priorityIndex(): number {
    return this.project
      ? this.priorityOptions.indexOf(this.project.priority)
      : 1;
  }

  onPriorityIndexChange(index: number) {
    this.setPriority(this.priorityOptions[index]);
  }

  selectDepartment(dept: Department | null) {
    if (!this.project) return;
    const department = dept ? dept.id : null;
    if ((this.project.department?.id ?? null) === department) return;
    this.projectService
      .updateProject(this.projectId, { department })
      .subscribe({
        next: (res) => (this.project = res.project),
      });
  }

  selectCategory(cat: Category | null) {
    if (!this.project) return;
    const category = cat ? cat.id : null;
    if ((this.project.category?.id ?? null) === category) return;
    this.projectService.updateProject(this.projectId, { category }).subscribe({
      next: (res) => (this.project = res.project),
    });
  }

  loadProject() {
    this.loading = true;
    this.projectService.getProjectById(this.projectId).subscribe({
      next: (project) => {
        this.project = project;
        this.editName = project.name;
        this.editDescription = project.description;
        this.detailsText = project.detailsText ?? '';
        this.detailsLayoutEntries = this.normalizeDetailsLayout(project.detailsLayout);
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load draft';
        this.loading = false;
      },
    });
  }

  loadItems() {
    if (this.tree.length === 0) this.itemsLoading = true;
    this.projectService.getItems(this.projectId).subscribe({
      next: (items) => {
        this.tree = buildProjectTree(items);
        this.itemsLoading = false;
        if (this.selectedNode) {
          const updated = this.findNode(this.tree, this.selectedNode.id);
          this.selectedNode = updated ?? null;
        }
      },
      error: () => (this.itemsLoading = false),
    });
    this.projectService.getItemsSummary(this.projectId).subscribe({
      next: (summary) => (this.itemSummary = summary),
    });
  }

  onItemSaved(updated: ProjectItem) {
    this.patchNode(this.tree, updated);
    this.tree = [...this.tree];
  }

  private patchNode(nodes: ProjectTreeNode[], updated: ProjectItem): boolean {
    for (const node of nodes) {
      if (node.id === updated.id) {
        Object.assign(node, updated);
        return true;
      }
      if (this.patchNode(node.children, updated)) return true;
    }
    return false;
  }

  private findNode(
    nodes: ProjectTreeNode[],
    id: number,
  ): ProjectTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.findNode(node.children, id);
      if (found) return found;
    }
    return null;
  }

  private findPath(
    nodes: ProjectTreeNode[],
    id: number,
    trail: ProjectTreeNode[],
  ): ProjectTreeNode[] | null {
    for (const node of nodes) {
      const nextTrail = [...trail, node];
      if (node.id === id) return nextTrail;
      const found = this.findPath(node.children, id, nextTrail);
      if (found) return found;
    }
    return null;
  }

  get selectedPath(): ProjectTreeNode[] {
    if (!this.selectedNode) return [];
    return (
      this.findPath(this.tree, this.selectedNode.id, []) ?? [this.selectedNode]
    );
  }

  backToDrafts() {
    this.router.navigate(['/drafts']);
  }

  setActiveTab(key: string) {
    this.activeTab = key;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: key },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  saveNameDescription() {
    if (!this.project) return;
    const name = this.editName.trim();
    if (!name) {
      this.editName = this.project.name;
      return;
    }
    if (
      name === this.project.name &&
      this.editDescription === this.project.description
    )
      return;

    this.projectService
      .updateProject(this.projectId, {
        name,
        description: this.editDescription,
      })
      .subscribe({
        next: (res) => {
          this.project = res.project;
          this.editName = res.project.name;
          this.editDescription = res.project.description;
        },
      });
  }

  saveDetailsText() {
    if (!this.project || this.detailsText === this.project.detailsText) return;
    this.projectService
      .updateProject(this.projectId, { detailsText: this.detailsText })
      .subscribe({
        next: (res) => (this.project = res.project),
      });
  }

  setEffort(effort: ProjectEffort) {
    if (!this.project || this.project.effort === effort) return;
    this.projectService.updateProject(this.projectId, { effort }).subscribe({
      next: (res) => (this.project = res.project),
    });
  }

  get effortIndex(): number {
    return this.project ? this.effortOptions.indexOf(this.project.effort) : 1;
  }

  onEffortIndexChange(index: number) {
    this.setEffort(this.effortOptions[index]);
  }

  // ── Details-tab card layout (drag reorder + resize) ──
  private normalizeDetailsLayout(saved?: ProjectDetailsLayoutEntry[] | null): ProjectDetailsLayoutEntry[] {
    const known = new Set(this.DEFAULT_DETAIL_CARD_IDS);
    const seen = new Set<string>();
    const result: ProjectDetailsLayoutEntry[] = [];
    for (const entry of saved ?? []) {
      if (!known.has(entry.cardId) || seen.has(entry.cardId)) continue;
      seen.add(entry.cardId);
      result.push({ cardId: entry.cardId, width: entry.width ?? null, height: entry.height ?? null });
    }
    for (const cardId of this.DEFAULT_DETAIL_CARD_IDS) {
      if (!seen.has(cardId)) result.push({ cardId, width: null, height: null });
    }
    return result;
  }

  get orderedDetailCardIds(): string[] {
    return this.detailsLayoutEntries.map((e) => e.cardId);
  }

  layoutSize(cardId: string): { width: number | null; height: number | null } {
    const entry = this.detailsLayoutEntries.find((e) => e.cardId === cardId);
    return { width: entry?.width ?? null, height: entry?.height ?? null };
  }

  onDetailsDrop(event: CdkDragDrop<string[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.detailsLayoutEntries, event.previousIndex, event.currentIndex);
    this.saveDetailsLayout();
  }

  onCardResized(cardId: string, size: CardResizeEvent) {
    const entry = this.detailsLayoutEntries.find((e) => e.cardId === cardId);
    if (!entry) return;
    entry.width = size.width;
    entry.height = size.height;
    this.saveDetailsLayout();
  }

  private saveDetailsLayout() {
    this.projectService.updateDetailsLayout(this.projectId, this.detailsLayoutEntries).subscribe({
      next: (res) => {
        if (this.project) this.project = { ...this.project, detailsLayout: res.project.detailsLayout };
      },
      error: (err) => {
        this.notifications.error(err.error?.message || 'Failed to save layout');
      },
    });
  }

  openDeleteConfirm() {
    this.deleteConfirmOpen = true;
  }

  cancelDeleteConfirm() {
    this.deleteConfirmOpen = false;
  }

  confirmDeleteProject() {
    this.deleteLoading = true;
    this.projectService.deleteProject(this.projectId).subscribe({
      next: () => {
        this.deleteLoading = false;
        this.deleteConfirmOpen = false;
        this.router.navigate(['/drafts']);
      },
      error: () => {
        this.deleteLoading = false;
        this.deleteConfirmOpen = false;
      },
    });
  }

  openAddGroup() {
    this.addGroupOpen = true;
    this.addGroupTitle = '';
    this.addGroupError = '';
  }

  cancelAddGroup() {
    this.addGroupOpen = false;
    this.addGroupError = '';
  }

  onAddGroupKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    this.submitAddGroup();
  }

  submitAddGroup() {
    const title = this.addGroupTitle.trim();
    if (!title) return;
    this.addGroupLoading = true;
    this.addGroupError = '';
    this.projectService
      .createItem(this.projectId, { title, parentId: null })
      .subscribe({
        next: (res) => {
          this.addGroupLoading = false;
          this.addGroupOpen = false;
          this.tree = [...this.tree, { ...res.item, children: [], childCount: 0 }];
        },
        error: (err) => {
          this.addGroupError = err.error?.message || 'Failed to add group';
          this.addGroupLoading = false;
        },
      });
  }

  onOpenDetail(node: ProjectTreeNode) {
    this.selectedNode = node;
  }

  closeDetail() {
    this.selectedNode = null;
  }

  private removeNodeById(nodes: ProjectTreeNode[], id: number): boolean {
    const index = nodes.findIndex((n) => n.id === id);
    if (index !== -1) {
      nodes.splice(index, 1);
      return true;
    }
    for (const node of nodes) {
      if (this.removeNodeById(node.children, id)) {
        node.childCount = node.children.length;
        return true;
      }
    }
    return false;
  }

  onNodeDeleted(id: number) {
    this.removeNodeById(this.tree, id);
    this.tree = [...this.tree];
    if (this.selectedNode?.id === id) this.selectedNode = null;
  }

  onDropRoot(event: CdkDragDrop<ProjectTreeNode[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.tree, event.previousIndex, event.currentIndex);
    const orderedIds = this.tree.map((n) => n.id);
    this.projectService
      .reorderItems(this.projectId, null, orderedIds)
      .subscribe({
        error: () => this.loadItems(),
      });
  }

  get groups(): ProjectTreeNode[] {
    return this.tree.filter((n) => n.type === 'group');
  }

  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    this.selectedIds.clear();
  }

  expandAll() {
    this.expandCommand = { expand: true, token: ++this.expandToken };
  }

  collapseAll() {
    this.expandCommand = { expand: false, token: ++this.expandToken };
  }

  onToggleSelect(id: number) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  openMoveToGroupForTask(node: ProjectTreeNode) {
    this.moveGroupMode = 'single';
    this.moveGroupTargetNode = node;
    this.moveGroupOpen = true;
  }

  openBulkMoveToGroup() {
    if (this.selectedIds.size === 0) return;
    this.moveGroupMode = 'bulk';
    this.moveGroupOpen = true;
  }

  cancelMoveToGroup() {
    this.moveGroupOpen = false;
  }

  private applyTaskMoveLocally(node: ProjectTreeNode, newGroupId: number) {
    const oldGroup = this.groups.find((g) => g.id === node.parentId);
    if (oldGroup) {
      oldGroup.children = oldGroup.children.filter((c) => c.id !== node.id);
      oldGroup.childCount = oldGroup.children.length;
    }
    const newGroup = this.groups.find((g) => g.id === newGroupId);
    if (newGroup) {
      node.parentId = newGroupId;
      newGroup.children = [...newGroup.children, node];
      newGroup.childCount = newGroup.children.length;
    }
    this.tree = [...this.tree];
  }

  private applyBulkTaskMoveLocally(itemIds: number[], newGroupId: number) {
    const newGroup = this.groups.find((g) => g.id === newGroupId);
    if (!newGroup) return;
    for (const id of itemIds) {
      for (const group of this.groups) {
        if (group.id === newGroupId) continue;
        const index = group.children.findIndex((c) => c.id === id);
        if (index !== -1) {
          const [moved] = group.children.splice(index, 1);
          group.childCount = group.children.length;
          moved.parentId = newGroupId;
          newGroup.children.push(moved);
          break;
        }
      }
    }
    newGroup.childCount = newGroup.children.length;
    this.tree = [...this.tree];
  }

  onGroupSelectedForMove(groupId: number) {
    if (this.moveGroupMode === 'single') {
      const node = this.moveGroupTargetNode;
      if (!node) return;
      if (node.parentId === groupId) {
        this.moveGroupOpen = false;
        this.notifications.error('Task is already in this group.');
        return;
      }
      this.moveGroupLoading = true;
      this.projectService.moveItemToParent(this.projectId, node.id, groupId).subscribe({
        next: () => {
          this.moveGroupLoading = false;
          this.moveGroupOpen = false;
          const groupTitle = this.groups.find((g) => g.id === groupId)?.title ?? 'group';
          this.applyTaskMoveLocally(node, groupId);
          this.notifications.success(`Task moved to "${groupTitle}".`);
        },
        error: (err) => {
          this.moveGroupLoading = false;
          this.notifications.error(err.error?.message || 'Failed to move task');
        },
      });
    } else {
      const itemIds = Array.from(this.selectedIds);
      this.moveGroupLoading = true;
      this.projectService.bulkMoveItemsToParent(this.projectId, itemIds, groupId).subscribe({
        next: (res) => {
          this.moveGroupLoading = false;
          this.moveGroupOpen = false;
          this.applyBulkTaskMoveLocally(itemIds, groupId);
          this.selectedIds.clear();
          this.notifications.success(
            `${res.movedCount} task(s) moved${res.alreadyInGroupCount ? ` (${res.alreadyInGroupCount} already in this group)` : ''}.`
          );
        },
        error: (err) => {
          this.moveGroupLoading = false;
          this.notifications.error(err.error?.message || 'Failed to move tasks');
        },
      });
    }
  }

  openBulkDeleteConfirm() {
    if (this.selectedIds.size === 0) return;
    this.bulkDeleteConfirmOpen = true;
  }

  cancelBulkDelete() {
    this.bulkDeleteConfirmOpen = false;
  }

  confirmBulkDelete() {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) {
      this.bulkDeleteConfirmOpen = false;
      return;
    }
    this.bulkDeleteLoading = true;
    forkJoin(ids.map((id) => this.projectService.deleteItem(this.projectId, id))).subscribe({
      next: () => {
        this.bulkDeleteLoading = false;
        this.bulkDeleteConfirmOpen = false;
        for (const id of ids) this.removeNodeById(this.tree, id);
        this.tree = [...this.tree];
        this.selectedIds.clear();
        if (this.selectedNode && ids.includes(this.selectedNode.id)) this.selectedNode = null;
        this.notifications.success(`${ids.length} task(s) deleted.`);
      },
      error: () => {
        this.bulkDeleteLoading = false;
        this.bulkDeleteConfirmOpen = false;
        this.selectedIds.clear();
        this.loadItems();
      },
    });
  }
}
