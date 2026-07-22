import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalDirective } from '../modal.directive';
import { ProjectService } from '../../core/services/project.service';
import { Project } from '../../models/project.model';
import { ProjectItem, ProjectItemType } from '../../models/project-item.model';

@Component({
  selector: 'app-move-to-project-dialog',
  standalone: true,
  imports: [FormsModule, ModalDirective],
  templateUrl: './move-to-project-dialog.component.html',
  styleUrl: './move-to-project-dialog.component.css',
})
export class MoveToProjectDialogComponent implements OnChanges {
  @Input() open = false;
  @Input() itemType: ProjectItemType = 'task';
  @Input() currentProjectId = '';
  @Input() loading = false; // parent-controlled: the actual move-to-project call is in flight

  @Output() moveConfirmed = new EventEmitter<{ targetProjectId: number; targetParentId: number | null }>();
  @Output() cancelled = new EventEmitter<void>();

  step: 'project' | 'parent' = 'project';

  projects: Project[] = [];
  projectsLoading = false;
  projectsError: string | null = null;
  projectSearch = '';

  selectedProject: Project | null = null;
  parentItems: ProjectItem[] = [];
  parentItemsLoading = false;
  parentItemsError: string | null = null;
  parentSearch = '';

  constructor(private projectService: ProjectService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.step = 'project';
      this.projectSearch = '';
      this.selectedProject = null;
      this.parentItems = [];
      this.parentSearch = '';
      this.loadProjects();
    }
  }

  get filteredProjects(): Project[] {
    const q = this.projectSearch.trim().toLowerCase();
    if (!q) return this.projects;
    return this.projects.filter((p) => p.name.toLowerCase().includes(q));
  }

  get filteredParentItems(): ProjectItem[] {
    const q = this.parentSearch.trim().toLowerCase();
    if (!q) return this.parentItems;
    return this.parentItems.filter((n) => n.title.toLowerCase().includes(q));
  }

  get parentPickerLabel(): string {
    return this.itemType === 'subtask' ? 'Select a destination task or subtask.' : 'Select a destination group.';
  }

  iconFor(type: ProjectItemType): string {
    return type === 'group' ? 'bi-folder2' : type === 'task' ? 'bi-check2-square' : 'bi-arrow-return-right';
  }

  loadProjects() {
    this.projectsLoading = true;
    this.projectsError = null;
    this.projectService.getProjects(1, 100, 'all', true).subscribe({
      next: (res) => {
        this.projectsLoading = false;
        this.projects = res.projects.filter((p) => String(p.id) !== this.currentProjectId);
      },
      error: () => {
        this.projectsLoading = false;
        this.projectsError = 'Failed to load projects.';
      },
    });
  }

  selectProject(project: Project) {
    if (this.itemType === 'group') {
      this.moveConfirmed.emit({ targetProjectId: project.id, targetParentId: null });
      return;
    }
    this.selectedProject = project;
    this.step = 'parent';
    this.loadParentItems(project.id);
  }

  loadParentItems(projectId: number) {
    this.parentItemsLoading = true;
    this.parentItemsError = null;
    this.projectService.getItems(String(projectId)).subscribe({
      next: (items) => {
        this.parentItemsLoading = false;
        this.parentItems =
          this.itemType === 'task'
            ? items.filter((n) => n.type === 'group')
            : items.filter((n) => n.type === 'task' || n.type === 'subtask');
      },
      error: () => {
        this.parentItemsLoading = false;
        this.parentItemsError = 'Failed to load this project’s items.';
      },
    });
  }

  selectParent(parent: ProjectItem) {
    if (!this.selectedProject) return;
    this.moveConfirmed.emit({ targetProjectId: this.selectedProject.id, targetParentId: parent.id });
  }

  backToProjects() {
    this.step = 'project';
    this.selectedProject = null;
    this.parentItems = [];
    this.parentSearch = '';
  }

  cancel() {
    this.cancelled.emit();
  }
}
