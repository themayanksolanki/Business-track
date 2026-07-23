import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { guestGuard } from './core/guards/guest.guard';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/register/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: 'forgot-password',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/forgot-password/forgot-password.component').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'accept-invite/:token',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/accept-invite/accept-invite.component').then((m) => m.AcceptInviteComponent),
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
    data: { roles: ['Admin', 'Manager'] },
    loadComponent: () => import('./pages/user-list/user-list.component').then((m) => m.UserListComponent),
  },
  {
    path: 'organization',
    canActivate: [authGuard, roleGuard],
    data: { roles: ['Admin', 'Manager'] },
    loadComponent: () =>
      import('./pages/organization/organization.component').then((m) => m.OrganizationComponent),
  },
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/chat/chat.component').then((m) => m.ChatComponent),
  },
  {
    path: 'projects',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/projects/projects.component').then((m) => m.ProjectsComponent),
  },
  {
    // Shareable "Copy Project Link" entry point — org + per-org sequence
    // number, resolved by ProjectDetailComponent itself (redirects to the
    // normal route below if the visitor turns out to have real access).
    path: 'projects/shared/:organizationId/:sequenceId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/project-detail/project-detail.component').then((m) => m.ProjectDetailComponent),
  },
  {
    path: 'projects/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/project-detail/project-detail.component').then((m) => m.ProjectDetailComponent),
  },
  {
    path: 'drafts',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/drafts/drafts.component').then((m) => m.DraftsComponent),
  },
  {
    path: 'drafts/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/draft-detail/draft-detail.component').then((m) => m.DraftDetailComponent),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/profile/profile.component').then((m) => m.ProfileComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  }
];
