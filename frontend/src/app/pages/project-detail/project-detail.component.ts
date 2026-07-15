import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import moment from 'moment';
import { ProjectService } from '../../core/services/project.service';
import { UserService } from '../../core/services/user.service';
import { Project, ProjectPriority } from '../../models/project.model';
import { User } from '../../models/user.model';
import { ProjectTreeNode, CompletionRollup, buildProjectTree, computeCompletionRollup } from '../../models/project-item.model';
import { TabStripComponent, TabDef } from '../../shared/tab-strip/tab-strip.component';
import { ProjectTreeNodeComponent } from '../../shared/project-tree-node/project-tree-node.component';
import { ProjectItemDetailComponent } from '../../shared/project-item-detail/project-item-detail.component';
import { KanbanBoardComponent } from '../../shared/kanban-board/kanban-board.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { TimePickerComponent } from '../../shared/time-picker/time-picker.component';

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
  ],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css',
})
export class ProjectDetailComponent implements OnInit {
  projectId = '';
  project: Project | null = null;
  loading = false;
  error = '';

  tabs: TabDef[] = [
    { key: 'tasks', label: 'Tasks', icon: 'bi-list-task' },
    { key: 'kanban', label: 'Kanban', icon: 'bi-kanban' },
  ];
  activeTab = 'tasks';

  tree: ProjectTreeNode[] = [];
  itemsLoading = false;

  addGroupOpen = false;
  addGroupTitle = '';
  addGroupLoading = false;
  addGroupError = '';

  selectedNode: ProjectTreeNode | null = null;

  editName = '';
  editDescription = '';
  startDateStr: string | null = null;
  startTimeStr: string | null = null;
  endDateStr: string | null = null;
  endTimeStr: string | null = null;

  deleteConfirmOpen = false;
  deleteLoading = false;

  users: User[] = [];
  readonly priorityOptions: ProjectPriority[] = ['low', 'medium', 'high'];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private projectService: ProjectService,
    private userService: UserService
  ) {}

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('id') || '';
    this.loadProject();
    this.loadItems();
    this.userService.getAllUsers().subscribe({ next: (u) => (this.users = u) });
  }

  get progress(): CompletionRollup {
    return computeCompletionRollup(this.tree);
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }

  selectOwner(user: User | null) {
    if (!this.project) return;
    const owner = user ? user.id ?? user._id ?? null : null;
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

  loadProject() {
    this.loading = true;
    this.projectService.getProjectById(this.projectId).subscribe({
      next: (project) => {
        this.project = project;
        this.editName = project.name;
        this.editDescription = project.description;
        this.startDateStr = project.startDate ? moment(project.startDate).format('YYYY-MM-DD') : null;
        this.startTimeStr = project.startDate ? moment(project.startDate).format('HH:mm') : null;
        this.endDateStr = project.endDate ? moment(project.endDate).format('YYYY-MM-DD') : null;
        this.endTimeStr = project.endDate ? moment(project.endDate).format('HH:mm') : null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load project';
        this.loading = false;
      },
    });
  }

  loadItems() {
    this.itemsLoading = true;
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
  }

  private findNode(nodes: ProjectTreeNode[], id: string): ProjectTreeNode | null {
    for (const node of nodes) {
      if (node._id === id) return node;
      const found = this.findNode(node.children, id);
      if (found) return found;
    }
    return null;
  }

  private findPath(nodes: ProjectTreeNode[], id: string, trail: ProjectTreeNode[]): ProjectTreeNode[] | null {
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
    return this.findPath(this.tree, this.selectedNode._id, []) ?? [this.selectedNode];
  }

  backToProjects() {
    this.router.navigate(['/projects']);
  }

  saveNameDescription() {
    if (!this.project) return;
    const name = this.editName.trim();
    if (!name) {
      this.editName = this.project.name;
      return;
    }
    if (name === this.project.name && this.editDescription === this.project.description) return;

    this.projectService.updateProject(this.projectId, { name, description: this.editDescription }).subscribe({
      next: (res) => {
        this.project = res.project;
        this.editName = res.project.name;
        this.editDescription = res.project.description;
      },
    });
  }

  private combineDateTime(date: string | null, time: string | null): string | null {
    if (!date) return null;
    return moment(`${date} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
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
    const startDate = this.combineDateTime(this.startDateStr, this.startTimeStr);
    const endDate = this.combineDateTime(this.endDateStr, this.endTimeStr);
    this.projectService.updateProject(this.projectId, { startDate, endDate }).subscribe({
      next: (res) => (this.project = res.project),
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

  submitAddGroup() {
    const title = this.addGroupTitle.trim();
    if (!title) return;
    this.addGroupLoading = true;
    this.addGroupError = '';
    this.projectService.createItem(this.projectId, { title, parentId: null }).subscribe({
      next: () => {
        this.addGroupLoading = false;
        this.addGroupOpen = false;
        this.loadItems();
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

  onDropRoot(event: CdkDragDrop<ProjectTreeNode[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.tree, event.previousIndex, event.currentIndex);
    const orderedIds = this.tree.map((n) => n._id);
    this.projectService.reorderItems(this.projectId, null, orderedIds).subscribe({
      error: () => this.loadItems(),
    });
  }
}
