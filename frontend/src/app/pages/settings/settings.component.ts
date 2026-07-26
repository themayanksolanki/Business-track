import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TabStripComponent, TabDef } from '../../shared/tab-strip/tab-strip.component';
import { DepartmentsComponent } from './departments/departments.component';
import { TagsComponent } from './tags/tags.component';
import { CategoriesComponent } from './categories/categories.component';
import { ProjectRolesComponent } from './project-roles/project-roles.component';
import { GeneralSettingsComponent } from './general/general.component';

const DEFAULT_TAB = 'general';
const VALID_TABS = ['general', 'departments', 'tags', 'categories', 'projectRoles'];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    TabStripComponent,
    GeneralSettingsComponent,
    DepartmentsComponent,
    TagsComponent,
    CategoriesComponent,
    ProjectRolesComponent,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent implements OnInit {
  tabs: TabDef[] = [
    { key: 'general', label: 'General', icon: 'bi-gear' },
    { key: 'departments', label: 'Departments', icon: 'bi-diagram-3' },
    { key: 'tags', label: 'Tags', icon: 'bi-tags' },
    { key: 'categories', label: 'Categories', icon: 'bi-bookmark' },
    { key: 'projectRoles', label: 'Project Roles', icon: 'bi-person-badge' },
  ];
  activeTab = DEFAULT_TAB;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab && VALID_TABS.includes(tab)) {
      this.activeTab = tab;
    }
  }

  setActiveTab(tab: string) {
    this.activeTab = tab;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === DEFAULT_TAB ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
