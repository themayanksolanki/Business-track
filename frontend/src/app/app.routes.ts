import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./pages/forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'tasks',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/task-list/task-list.component').then((m) => m.TaskListComponent),
  },
{
    path: 'tasks/:id/edit',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/edit-task/edit-task.component').then((m) => m.EditTaskComponent),
  },
  {
    path: 'users',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['Manager', 'Team Lead'] },
    loadComponent: () => import('./pages/user-list/user-list.component').then((m) => m.UserListComponent),
  },
  {
    path: 'team-tasks',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['Team Lead'] },
    loadComponent: () =>
      import('./pages/team-lead-task-view/team-lead-task-view.component').then(
        (m) => m.TeamLeadTaskViewComponent
      ),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  }
];
