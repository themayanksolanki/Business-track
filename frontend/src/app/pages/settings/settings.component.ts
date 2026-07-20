import { Component } from '@angular/core';
import { TabStripComponent, TabDef } from '../../shared/tab-strip/tab-strip.component';
import { DepartmentsComponent } from './departments/departments.component';
import { TagsComponent } from './tags/tags.component';
import { CategoriesComponent } from './categories/categories.component';
import { ProjectRolesComponent } from './project-roles/project-roles.component';
import { GeneralSettingsComponent } from './general/general.component';

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
export class SettingsComponent {
  tabs: TabDef[] = [
    { key: 'general', label: 'General', icon: 'bi-gear' },
    { key: 'departments', label: 'Departments', icon: 'bi-diagram-3' },
    { key: 'tags', label: 'Tags', icon: 'bi-tags' },
    { key: 'categories', label: 'Categories', icon: 'bi-bookmark' },
    { key: 'projectRoles', label: 'Project Roles', icon: 'bi-person-badge' },
  ];
  activeTab = 'general';
}
