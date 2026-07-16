import { Component } from '@angular/core';
import { TabStripComponent, TabDef } from '../../shared/tab-strip/tab-strip.component';
import { DepartmentsComponent } from './departments/departments.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [TabStripComponent, DepartmentsComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
})
export class SettingsComponent {
  tabs: TabDef[] = [{ key: 'departments', label: 'Departments', icon: 'bi-diagram-3' }];
  activeTab = 'departments';
}
