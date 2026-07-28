import { Component, Input, effect, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectService } from '../../core/services/project.service';
import { SidebarService } from '../../core/services/sidebar.service';
import { Project } from '../../models/project.model';

// Slide-in overlay listing every project (name + department), read straight
// from ProjectService's shared cache — no request of its own, EXCEPT for the
// retry below. Toggled from a button at the top of the global sidebar (see
// sidebar.component.ts), which is why open state lives in SidebarService
// rather than a local boolean: the button and this overlay are otherwise
// unrelated components.
@Component({
  selector: 'app-project-list-overlay',
  standalone: true,
  templateUrl: './project-list-overlay.component.html',
  styleUrl: './project-list-overlay.component.css',
})
export class ProjectListOverlayComponent {
  @Input() currentProjectId: number | null = null;

  constructor(
    public sidebarSvc: SidebarService,
    public projectService: ProjectService,
    private router: Router
  ) {
    // ensureProjectListLoaded() (called once from ProjectDetailComponent's
    // ngOnInit) never retries if that single request fails or loses a race
    // with auth setup on a direct deep link — leaving this overlay blank for
    // the rest of the session. Self-heal instead: on every open transition,
    // if the cache is still empty, refetch once. projectList() is read
    // untracked so a genuinely-empty org doesn't retrigger this effect every
    // time refreshProjectList() writes the (still empty) array back.
    effect(() => {
      const isOpen = this.sidebarSvc.projectListOverlayOpen();
      if (isOpen && untracked(() => this.projectService.projectList().length) === 0) {
        this.projectService.refreshProjectList().subscribe();
      }
    });
  }

  select(project: Project) {
    this.router.navigate(['/projects', project.id]);
    this.sidebarSvc.closeProjectListOverlay();
  }

  close() {
    this.sidebarSvc.closeProjectListOverlay();
  }
}
