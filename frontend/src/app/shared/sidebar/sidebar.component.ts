import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { NgbDropdown, NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { ProjectsViewMode, ProjectsViewService } from '../../core/services/projects-view.service';
import { SidebarAppearanceService } from '../../core/services/sidebar-appearance.service';
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  SidebarService,
} from '../../core/services/sidebar.service';
import { IconComponent, IconName } from '../icon/icon.component';
import { NotificationBellComponent } from '../notification-bell/notification-bell.component';
import { SIDEBAR_LOGOS } from '../sidebar-logo-data';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    IconComponent,
    NotificationBellComponent,
    NgbDropdownModule,
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css',
})
export class SidebarComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly chatSvc = inject(ChatService);
  readonly svc = inject(SidebarService);
  readonly projectsView = inject(ProjectsViewService);
  readonly appearance = inject(SidebarAppearanceService);
  private readonly router = inject(Router);

  @ViewChild('sidebarEl') private sidebarEl?: ElementRef<HTMLElement>;

  brandIcon(): IconName {
    const key = this.auth.currentUser()?.sidebarLogo ?? 'CHECK';
    return SIDEBAR_LOGOS.find((l) => l.key === key)?.icon ?? 'brand';
  }

  // Flyout submenus (Projects/Metrics) render into <body> via ngbDropdown's
  // container:'body' config so they aren't clipped by .sidebar-nav's
  // overflow-x:hidden — but that also takes them out of .app-sidebar's
  // subtree, so they stop inheriting its per-theme --sb-* custom properties.
  // Copy the live resolved values on as they open.
  private readonly submenuThemeVars = [
    '--sb-submenu-bg',
    '--sb-text',
    '--sb-text-hover',
    '--sb-text-override',
    '--sb-overlay-1',
    '--sb-overlay-2',
    '--sb-active-bg',
  ];

  syncSubmenuTheme(menuEl: HTMLElement) {
    if (!this.sidebarEl) return;
    const computed = getComputedStyle(this.sidebarEl.nativeElement);
    for (const name of this.submenuThemeVars) {
      menuEl.style.setProperty(name, computed.getPropertyValue(name));
    }
  }

  private readonly closeTimers = new Map<NgbDropdown, ReturnType<typeof setTimeout>>();

  // The flyout (.nav-submenu) is teleported out to <body> by ngbDropdown's
  // container:'body' config once open, so it's no longer a DOM descendant of
  // .nav-item-group — moving the cursor from the nav item onto the flyout
  // crosses out of .nav-item-group's bounding box and would otherwise fire
  // mouseleave instantly. Both the trigger and the flyout call these same
  // two methods so hovering either cancels/reschedules the same close timer.
  onMouseEnter(dd: NgbDropdown, menu: HTMLElement) {
    this.syncSubmenuTheme(menu);
    this.clearCloseTimer(dd);
    if (!dd.isOpen()) {
      dd.open();
    }
  }

  onMouseLeave(dd: NgbDropdown) {
    this.clearCloseTimer(dd);
    this.closeTimers.set(
      dd,
      setTimeout(() => {
        this.closeTimers.delete(dd);
        dd.close();
      }, 150),
    );
  }

  private clearCloseTimer(dd: NgbDropdown) {
    const timer = this.closeTimers.get(dd);
    if (timer) {
      clearTimeout(timer);
      this.closeTimers.delete(dd);
    }
  }

  private dragStartX = 0;
  private dragStartWidth = 0;
  private readonly collapseSnapPoint =
    (SIDEBAR_MIN_WIDTH + SIDEBAR_RAIL_WIDTH) / 2;

  private readonly onPointerMove = (event: PointerEvent) =>
    this.handlePointerMove(event);
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
    for (const timer of this.closeTimers.values()) {
      clearTimeout(timer);
    }
  }

  private handlePointerMove(event: PointerEvent) {
    const proposed = this.dragStartWidth + (event.clientX - this.dragStartX);

    if (proposed <= this.collapseSnapPoint) {
      this.svc.setCollapsed(true);
      return;
    }

    this.svc.setCollapsed(false);
    this.svc.setExpandedWidth(
      Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, proposed)),
    );
  }

  private stopDrag() {
    this.svc.setDragging(false);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
}
