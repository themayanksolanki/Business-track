import { Injectable, signal } from '@angular/core';

export type ProjectsViewMode = 'cards' | 'table' | 'list';

const VIEW_KEY = 'projects-view-mode';

@Injectable({ providedIn: 'root' })
export class ProjectsViewService {
  private readonly _viewMode = signal<ProjectsViewMode>(this.readInitial());
  readonly viewMode = this._viewMode.asReadonly();

  setViewMode(mode: ProjectsViewMode) {
    if (mode === this._viewMode()) return;
    this._viewMode.set(mode);
    localStorage.setItem(VIEW_KEY, mode);
  }

  private readInitial(): ProjectsViewMode {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved === 'cards' || saved === 'table' || saved === 'list' ? saved : 'list';
  }
}
