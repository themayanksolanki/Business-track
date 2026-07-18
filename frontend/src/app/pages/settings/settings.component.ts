import { Component } from '@angular/core';
import { TabStripComponent, TabDef } from '../../shared/tab-strip/tab-strip.component';
import { DepartmentsComponent } from './departments/departments.component';
import { TagsComponent } from './tags/tags.component';
import { CategoriesComponent } from './categories/categories.component';
import { ProjectRolesComponent } from './project-roles/project-roles.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [TabStripComponent, DepartmentsComponent, TagsComponent, CategoriesComponent, ProjectRolesComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  tabs: TabDef[] = [
    { key: 'departments', label: 'Departments', icon: 'bi-diagram-3' },
    { key: 'tags', label: 'Tags', icon: 'bi-tags' },
    { key: 'categories', label: 'Categories', icon: 'bi-bookmark' },
    { key: 'projectRoles', label: 'Project Roles', icon: 'bi-person-badge' },
  ];
  activeTab = 'departments';
}
