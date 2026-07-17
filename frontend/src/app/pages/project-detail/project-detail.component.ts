import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin } from 'rxjs';
import dayjs from 'dayjs/esm';
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
import 'ckeditor5/ckeditor5.css';
import { environment } from '../../../environments/environment';
import { ProjectService } from '../../core/services/project.service';
import { UserService } from '../../core/services/user.service';
import { DepartmentService } from '../../core/services/department.service';
import { Project, ProjectPriority, ProjectEffort, ProjectLink } from '../../models/project.model';
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
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { TimePickerComponent } from '../../shared/time-picker/time-picker.component';
import { AutoGrowDirective } from '../../shared/auto-grow.directive';
import { AuthService } from '../../core/services/auth.service';
import { ProjectAttachmentsCardComponent } from '../../shared/project-attachments-card/project-attachments-card.component';
import { ProjectPlanCardComponent } from '../../shared/project-plan-card/project-plan-card.component';
import { TagService } from '../../core/services/tag.service';
import { Tag, TagLite } from '../../models/tag.model';
import { TagPickerComponent } from '../../shared/tag-picker/tag-picker.component';
import { DropListRegistryService } from '../../shared/drop-list-registry.service';
import { NotificationService } from '../../shared/notification.service';
import { MoveToGroupDialogComponent } from '../../shared/move-to-group-dialog/move-to-group-dialog.component';

@Component({
  selector: 'app-project-detail',
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
    DatePickerComponent,
    TimePickerComponent,
    AutoGrowDirective,
    ProjectAttachmentsCardComponent,
    ProjectPlanCardComponent,
    TagPickerComponent,
    CKEditorModule,
    MoveToGroupDialogComponent,
  ],
  providers: [DropListRegistryService],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css',
})
export class ProjectDetailComponent implements OnInit {
  projectId = '';
  project: Project | null = null;
  loading = false;
  error = '';

  tabs: TabDef[] = [
    { key: 'detail', label: 'Details', icon: 'bi-info-circle' },
    { key: 'tasks', label: 'Tasks', icon: 'bi-list-task' },
    { key: 'kanban', label: 'Kanban', icon: 'bi-kanban' },
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
  selectedIds = new Set<string>();

  moveGroupOpen = false;
  moveGroupMode: 'single' | 'bulk' = 'single';
  moveGroupLoading = false;
  moveGroupTargetNode: ProjectTreeNode | null = null;

  bulkDeleteConfirmOpen = false;
  bulkDeleteLoading = false;

  editName = '';
  editDescription = '';
  startDateStr: string | null = null;
  startTimeStr: string | null = null;
  endDateStr: string | null = null;
  endTimeStr: string | null = null;

  deleteConfirmOpen = false;
  deleteLoading = false;

  users: User[] = [];
  departments: Department[] = [];
  categories: Category[] = [];
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
  detailsEditorExpanded = false;

  toggleDetailsEditorExpanded() {
    this.detailsEditorExpanded = !this.detailsEditorExpanded;
  }

  links: ProjectLink[] = [];
  newLinkTitle = '';
  newLinkUrl = '';
  linksError = '';

  allTags: Tag[] = [];

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
    if (tab === 'detail' || tab === 'tasks' || tab === 'kanban') this.activeTab = tab;
    this.loadProject();
    this.loadItems();
    this.userService.getAllUsers().subscribe({ next: (u) => (this.users = u) });
    this.departmentService
      .getDepartments()
      .subscribe({ next: (d) => (this.departments = d) });
    this.categoryService
      .getCategories()
      .subscribe({ next: (c) => (this.categories = c) });
    this.tagService.getTags().subscribe({ next: (t) => (this.allTags = t) });
  }

  selectTags(tags: TagLite[]) {
    if (!this.project) return;
    this.projectService
      .updateProject(this.projectId, { tags: tags.map((t) => t._id) })
      .subscribe({
        next: (res) => (this.project = res.project),
      });
  }

  onTagCreated(tag: Tag) {
    this.allTags = [...this.allTags, tag];
  }

  get progress(): CompletionRollup {
    return computeCompletionRollup(this.tree);
  }

  get durationLabel(): string {
    if (!this.project?.startDate || !this.project?.endDate) return '—';

    const totalMinutes = dayjs(this.project.endDate).diff(
      dayjs(this.project.startDate),
      'minute',
    );
    if (totalMinutes <= 0) return '0m';

    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (!days && minutes) parts.push(`${minutes}m`);

    return parts.join(' ');
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  private brokenAvatarIds = new Set<string>();

  avatarUrl(user: User): string | null {
    const id = (user._id ?? user.id) as string;
    if (this.brokenAvatarIds.has(id)) return null;
    return this.auth.avatarUrl(user);
  }

  onAvatarError(user: User) {
    this.brokenAvatarIds.add((user._id ?? user.id) as string);
  }

  selectOwner(user: User | null) {
    if (!this.project) return;
    const owner = user ? (user.id ?? user._id ?? null) : null;
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
    const department = dept ? dept._id : null;
    if ((this.project.department?._id ?? null) === department) return;
    this.projectService
      .updateProject(this.projectId, { department })
      .subscribe({
        next: (res) => (this.project = res.project),
      });
  }

  selectCategory(cat: Category | null) {
    if (!this.project) return;
    const category = cat ? cat._id : null;
    if ((this.project.category?._id ?? null) === category) return;
    this.projectService.updateProject(this.projectId, { category }).subscribe({
      next: (res) => (this.project = res.project),
    });
  }

  toggleComplete() {
    if (!this.project) return;
    const status = this.project.status === 'completed' ? 'active' : 'completed';
    this.projectService.updateProject(this.projectId, { status }).subscribe({
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
        this.startDateStr = project.startDate
          ? dayjs(project.startDate).format('YYYY-MM-DD')
          : null;
        this.startTimeStr = project.startDate
          ? dayjs(project.startDate).format('HH:mm')
          : null;
        this.endDateStr = project.endDate
          ? dayjs(project.endDate).format('YYYY-MM-DD')
          : null;
        this.endTimeStr = project.endDate
          ? dayjs(project.endDate).format('HH:mm')
          : null;
        this.detailsText = project.detailsText ?? '';
        this.links = project.links ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load project';
        this.loading = false;
      },
    });
  }

  // Only shows the loading spinner on the very first fetch — once the tree
  // is populated, later calls (reorder/indent/outdent resyncs, error
  // recovery) swap the data in quietly instead of blanking the whole area.
  loadItems() {
    if (this.tree.length === 0) this.itemsLoading = true;
    this.projectService.getItems(this.projectId).subscribe({
      next: (items) => {
        this.tree = buildProjectTree(items);
        this.itemsLoading = false;
        if (this.selectedNode) {
          const updated = this.findNode(this.tree, this.selectedNode._id);
          this.selectedNode = updated ?? null;
        }
      },
      error: () => (this.itemsLoading = false),
    });
    this.projectService.getItemsSummary(this.projectId).subscribe({
      next: (summary) => (this.itemSummary = summary),
    });
  }

  // Patches a saved item straight into the tree in place, instead of
  // refetching + rebuilding it — a full reload was resetting Kanban scroll
  // position and flashing the page behind the modal on every field edit.
  onItemSaved(updated: ProjectItem) {
    this.patchNode(this.tree, updated);
    this.tree = [...this.tree];
  }

  private patchNode(nodes: ProjectTreeNode[], updated: ProjectItem): boolean {
    for (const node of nodes) {
      if (node._id === updated._id) {
        Object.assign(node, updated);
        return true;
      }
      if (this.patchNode(node.children, updated)) return true;
    }
    return false;
  }

  private findNode(
    nodes: ProjectTreeNode[],
    id: string,
  ): ProjectTreeNode | null {
    for (const node of nodes) {
      if (node._id === id) return node;
      const found = this.findNode(node.children, id);
      if (found) return found;
    }
    return null;
  }

  private findPath(
    nodes: ProjectTreeNode[],
    id: string,
    trail: ProjectTreeNode[],
  ): ProjectTreeNode[] | null {
    for (const node of nodes) {
      const nextTrail = [...trail, node];
      if (node._id === id) return nextTrail;
      const found = this.findPath(node.children, id, nextTrail);
      if (found) return found;
    }
    return null;
  }

  get selectedPath(): ProjectTreeNode[] {
    if (!this.selectedNode) return [];
    return (
      this.findPath(this.tree, this.selectedNode._id, []) ?? [this.selectedNode]
    );
  }

  backToProjects() {
    this.router.navigate(['/projects']);
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

  private combineDateTime(
    date: string | null,
    time: string | null,
  ): string | null {
    if (!date) return null;
    return dayjs(
      `${date} ${time || '00:00'}`,
      'YYYY-MM-DD HH:mm',
    ).toISOString();
  }

  onStartDateChange(date: string | null) {
    this.startDateStr = date;
    if (!date) this.startTimeStr = null;
    this.saveDates();
  }

  onStartTimeChange(time: string | null) {
    this.startTimeStr = time;
    this.saveDates();
  }

  onEndDateChange(date: string | null) {
    this.endDateStr = date;
    if (!date) this.endTimeStr = null;
    this.saveDates();
  }

  onEndTimeChange(time: string | null) {
    this.endTimeStr = time;
    this.saveDates();
  }

  private saveDates() {
    if (!this.project) return;
    const startDate = this.combineDateTime(
      this.startDateStr,
      this.startTimeStr,
    );
    const endDate = this.combineDateTime(this.endDateStr, this.endTimeStr);
    this.projectService
      .updateProject(this.projectId, { startDate, endDate })
      .subscribe({
        next: (res) => (this.project = res.project),
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

  onPlanChanged(project: Project) {
    this.project = project;
  }

  get isValidLinkUrl(): boolean {
    return (
      !this.newLinkUrl.trim() ||
      /^https?:\/\/[^\s]+\.[^\s]+$/i.test(this.newLinkUrl.trim())
    );
  }

  addLink() {
    const title = this.newLinkTitle.trim();
    const url = this.newLinkUrl.trim();
    this.linksError = '';

    if (!title || !url) {
      this.linksError = 'Both a title and a URL are required';
      return;
    }
    if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(url)) {
      this.linksError = 'URL must start with http:// or https://';
      return;
    }

    const updated = [...this.links, { title, url }];
    this.saveLinks(updated, () => {
      this.newLinkTitle = '';
      this.newLinkUrl = '';
    });
  }

  removeLink(index: number) {
    const updated = this.links.filter((_, i) => i !== index);
    this.saveLinks(updated);
  }

  private saveLinks(updated: ProjectLink[], onSuccess?: () => void) {
    if (!this.project) return;
    this.projectService
      .updateProject(this.projectId, { links: updated })
      .subscribe({
        next: (res) => {
          this.project = res.project;
          this.links = res.project.links;
          onSuccess?.();
        },
        error: (err) => {
          this.linksError = err.error?.message || 'Failed to save links';
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
        this.router.navigate(['/projects']);
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

  // Removes a node from wherever it lives in the tree (any depth) in place,
  // instead of refetching the whole tree after a delete.
  private removeNodeById(nodes: ProjectTreeNode[], id: string): boolean {
    const index = nodes.findIndex((n) => n._id === id);
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

  onNodeDeleted(id: string) {
    this.removeNodeById(this.tree, id);
    this.tree = [...this.tree];
    if (this.selectedNode?._id === id) this.selectedNode = null;
  }

  onDropRoot(event: CdkDragDrop<ProjectTreeNode[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.tree, event.previousIndex, event.currentIndex);
    const orderedIds = this.tree.map((n) => n._id);
    this.projectService
      .reorderItems(this.projectId, null, orderedIds)
      .subscribe({
        error: () => this.loadItems(),
      });
  }

  // ── Multi-select & bulk actions ──
  get groups(): ProjectTreeNode[] {
    return this.tree.filter((n) => n.type === 'group');
  }

  toggleSelectionMode() {
    this.selectionMode = !this.selectionMode;
    this.selectedIds.clear();
  }

  onToggleSelect(id: string) {
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

  // Task-to-group moves never change depth (tasks always live directly under
  // a group), so the move can be reflected locally: splice the node out of
  // its old group's children and push it into the new one, no refetch needed.
  private applyTaskMoveLocally(node: ProjectTreeNode, newGroupId: string) {
    const oldGroup = this.groups.find((g) => g._id === node.parentId);
    if (oldGroup) {
      oldGroup.children = oldGroup.children.filter((c) => c._id !== node._id);
      oldGroup.childCount = oldGroup.children.length;
    }
    const newGroup = this.groups.find((g) => g._id === newGroupId);
    if (newGroup) {
      node.parentId = newGroupId;
      newGroup.children = [...newGroup.children, node];
      newGroup.childCount = newGroup.children.length;
    }
    this.tree = [...this.tree];
  }

  private applyBulkTaskMoveLocally(itemIds: string[], newGroupId: string) {
    const newGroup = this.groups.find((g) => g._id === newGroupId);
    if (!newGroup) return;
    for (const id of itemIds) {
      for (const group of this.groups) {
        if (group._id === newGroupId) continue;
        const index = group.children.findIndex((c) => c._id === id);
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

  onGroupSelectedForMove(groupId: string) {
    if (this.moveGroupMode === 'single') {
      const node = this.moveGroupTargetNode;
      if (!node) return;
      if (node.parentId === groupId) {
        this.moveGroupOpen = false;
        this.notifications.error('Task is already in this group.');
        return;
      }
      this.moveGroupLoading = true;
      this.projectService.moveItemToParent(this.projectId, node._id, groupId).subscribe({
        next: () => {
          this.moveGroupLoading = false;
          this.moveGroupOpen = false;
          const groupTitle = this.groups.find((g) => g._id === groupId)?.title ?? 'group';
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
        if (this.selectedNode && ids.includes(this.selectedNode._id)) this.selectedNode = null;
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
