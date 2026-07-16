import { Component, OnDestroy, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { ProjectsViewMode, ProjectsViewService } from '../../core/services/projects-view.service';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  SidebarService,
} from '../../core/services/sidebar.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
})
export class SidebarComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly chatSvc = inject(ChatService);
  readonly svc = inject(SidebarService);
  readonly projectsView = inject(ProjectsViewService);
  private readonly router = inject(Router);

  private dragStartX = 0;
  private dragStartWidth = 0;
  private readonly collapseSnapPoint = (SIDEBAR_MIN_WIDTH + SIDEBAR_RAIL_WIDTH) / 2;

  private readonly onPointerMove = (event: PointerEvent) => this.handlePointerMove(event);
  private readonly onPointerUp = () => this.stopDrag();

  onDragStart(event: PointerEvent) {
    event.preventDefault();
    this.dragStartX = event.clientX;
    this.dragStartWidth = this.svc.currentWidth();
    this.svc.setDragging(true);
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointerup', this.onPointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  toggleCollapsed() {
    this.svc.toggleCollapsed();
  }

  labelsVisible(): boolean {
    return !this.svc.collapsed() || this.svc.mobileOpen();
  }

  toggleMobile() {
    this.svc.toggleMobileOpen();
  }

  closeMobile() {
    this.svc.setMobileOpen(false);
  }

  selectProjectsView(mode: ProjectsViewMode) {
    this.projectsView.setViewMode(mode);
    this.router.navigateByUrl('/projects');
    this.closeMobile();
  }

  ngOnDestroy() {
    this.stopDrag();
  }

  private handlePointerMove(event: PointerEvent) {
    const proposed = this.dragStartWidth + (event.clientX - this.dragStartX);

    if (proposed <= this.collapseSnapPoint) {
      this.svc.setCollapsed(true);
      return;
    }

    this.svc.setCollapsed(false);
    this.svc.setExpandedWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, proposed)));
  }

  private stopDrag() {
    this.svc.setDragging(false);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
