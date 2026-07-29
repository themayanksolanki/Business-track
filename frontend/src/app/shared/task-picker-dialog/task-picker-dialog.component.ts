import {
  Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { debounce, throttle } from 'lodash-es';
import { ModalDirective } from '../modal.directive';
import { ProjectService } from '../../core/services/project.service';
import { ProjectPickerRow } from '../../models/project.model';
import { ProjectItemPickerRow } from '../../models/project-item.model';

const PAGE_SIZE = 20;

// Generic "pick tasks to link" dialog — Project (searched/paginated) -> Group
// -> Task (multi-select + inline create). Deliberately has no notion of what
// it's linking tasks *to* (an event today; metrics are a planned future
// binding) — it just returns the ids the user picked/created via
// `tasksPicked`; the caller (e.g. <app-linked-tasks>) does the actual link
// API call through its own adapter.
@Component({
  selector: 'app-task-picker-dialog',
  standalone: true,
  imports: [FormsModule, ModalDirective],
  templateUrl: './task-picker-dialog.component.html',
  styleUrl: './task-picker-dialog.component.css',
})
export class TaskPickerDialogComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  // Task ids already linked elsewhere — rendered checked-and-locked in the
  // task step so the user can't pick the same task twice.
  @Input() excludeTaskIds: number[] = [];

  @Output() closed = new EventEmitter<void>();
  @Output() tasksPicked = new EventEmitter<number[]>();

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('panel') panelRef?: ElementRef<HTMLElement>;

  // Same IntersectionObserver-in-a-scrollable-panel pattern as
  // member-picker.component.ts.
  @ViewChild('sentinel') set sentinelEl(el: ElementRef<HTMLElement> | undefined) {
    this.intersectionObserver?.disconnect();
    if (!el || !this.panelRef) return;
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) this.throttledLoadMoreProjects();
      },
      { root: this.panelRef.nativeElement, threshold: 0 }
    );
    this.intersectionObserver.observe(el.nativeElement);
  }

  step: 'project' | 'group' | 'task' = 'project';

  // Project step — searched + paginated (infinite scroll)
  projectQuery = '';
  projects: ProjectPickerRow[] = [];
  private projectsPage = 1;
  projectsHasMore = true;
  projectsLoading = false;
  projectsLoadingMore = false;
  projectsError = '';

  // Group step — plain list, no pagination (naturally small)
  selectedProject: ProjectPickerRow | null = null;
  groups: ProjectItemPickerRow[] = [];
  groupsLoading = false;
  groupsError = '';

  // Task step — checkbox multi-select + inline create
  selectedGroup: ProjectItemPickerRow | null = null;
  tasks: ProjectItemPickerRow[] = [];
  tasksLoading = false;
  tasksError = '';
  selectedTaskIds = new Set<number>();

  newTaskTitle = '';
  creatingTask = false;
  createTaskError = '';

  private intersectionObserver?: IntersectionObserver;
  private readonly throttledLoadMoreProjects = throttle(() => this.loadMoreProjects(), 400, { leading: true, trailing: false });
  private readonly debouncedSearch = debounce(() => this.resetAndLoadProjects(), 350);

  constructor(private projectService: ProjectService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.step = 'project';
      this.projectQuery = '';
      this.selectedProject = null;
      this.groups = [];
      this.selectedGroup = null;
      this.tasks = [];
      this.selectedTaskIds = new Set();
      this.newTaskTitle = '';
      this.createTaskError = '';
      this.resetAndLoadProjects();
      setTimeout(() => this.searchInputRef?.nativeElement.focus(), 0);
    }
  }

  ngOnDestroy() {
    this.intersectionObserver?.disconnect();
    this.throttledLoadMoreProjects.cancel();
    this.debouncedSearch.cancel();
  }

  onProjectQueryChange() {
    this.debouncedSearch();
  }

  private resetAndLoadProjects() {
    this.projects = [];
    this.projectsPage = 1;
    this.projectsHasMore = true;
    this.loadMoreProjects();
  }

  private loadMoreProjects() {
    if (!this.projectsHasMore || this.projectsLoadingMore) return;
    this.projectsLoadingMore = true;
    this.projectsLoading = this.projects.length === 0;
    this.projectsError = '';
    this.projectService.searchProjectsMinimal(this.projectsPage, PAGE_SIZE, this.projectQuery.trim()).subscribe({
      next: (res) => {
        this.projects = [...this.projects, ...res.projects];
        this.projectsHasMore = this.projectsPage < res.totalPages;
        this.projectsPage++;
        this.projectsLoadingMore = false;
        this.projectsLoading = false;
      },
      error: (err) => {
        this.projectsError = err.error?.message || 'Failed to load projects';
        this.projectsLoadingMore = false;
        this.projectsLoading = false;
      },
    });
  }

  selectProject(project: ProjectPickerRow) {
    this.selectedProject = project;
    this.step = 'group';
    this.loadGroups();
  }

  private loadGroups() {
    if (!this.selectedProject) return;
    this.groupsLoading = true;
    this.groupsError = '';
    this.projectService.getProjectGroups(String(this.selectedProject.id)).subscribe({
      next: (res) => {
        this.groups = res.items;
        this.groupsLoading = false;
      },
      error: (err) => {
        this.groupsError = err.error?.message || 'Failed to load groups';
        this.groupsLoading = false;
      },
    });
  }

  selectGroup(group: ProjectItemPickerRow) {
    this.selectedGroup = group;
    this.step = 'task';
    this.selectedTaskIds = new Set();
    this.newTaskTitle = '';
    this.createTaskError = '';
    this.loadTasks();
  }

  private loadTasks() {
    if (!this.selectedProject || !this.selectedGroup) return;
    this.tasksLoading = true;
    this.tasksError = '';
    this.projectService.getGroupTasks(String(this.selectedProject.id), this.selectedGroup.id).subscribe({
      next: (res) => {
        this.tasks = res.items;
        this.tasksLoading = false;
      },
      error: (err) => {
        this.tasksError = err.error?.message || 'Failed to load tasks';
        this.tasksLoading = false;
      },
    });
  }

  isExcluded(taskId: number): boolean {
    return this.excludeTaskIds.includes(taskId);
  }

  isChecked(taskId: number): boolean {
    return this.isExcluded(taskId) || this.selectedTaskIds.has(taskId);
  }

  toggleTask(task: ProjectItemPickerRow) {
    if (this.isExcluded(task.id)) return;
    if (this.selectedTaskIds.has(task.id)) this.selectedTaskIds.delete(task.id);
    else this.selectedTaskIds.add(task.id);
  }

  createTask() {
    const title = this.newTaskTitle.trim();
    if (!title || !this.selectedProject || !this.selectedGroup) return;
    this.creatingTask = true;
    this.createTaskError = '';
    this.projectService.createItem(String(this.selectedProject.id), { title, parentId: this.selectedGroup.id }).subscribe({
      next: (res) => {
        this.tasks = [...this.tasks, { id: res.item.id, title: res.item.title, type: res.item.type, status: res.item.status }];
        this.selectedTaskIds.add(res.item.id);
        this.newTaskTitle = '';
        this.creatingTask = false;
      },
      error: (err) => {
        this.createTaskError = err.error?.message || 'Failed to create task';
        this.creatingTask = false;
      },
    });
  }

  backToProjects() {
    this.step = 'project';
    this.selectedProject = null;
    this.groups = [];
  }

  backToGroups() {
    this.step = 'group';
    this.selectedGroup = null;
    this.tasks = [];
    this.selectedTaskIds = new Set();
  }

  confirm() {
    this.tasksPicked.emit(Array.from(this.selectedTaskIds));
  }

  cancel() {
    this.closed.emit();
  }
}
