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
    // Public marketing page — viewable whether signed in or not, so no
    // guestGuard/authGuard here (unlike the rest of the auth-flow routes).
    path: 'pricing',
    loadComponent: () => import('./pages/pricing/pricing.component').then((m) => m.PricingComponent),
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
    path: 'metrics',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/metrics/metrics.component').then((m) => m.MetricsComponent),
  },
  {
    path: 'metrics/bowling',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/metric-bowling/metric-bowling.component').then((m) => m.MetricBowlingComponent),
  },
  {
    path: 'metrics/tiles',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/metric-tiles/metric-tiles.component').then((m) => m.MetricTilesComponent),
  },
  {
    // loadChildren (not loadComponent+inline children) so app.routes.ts —
    // part of the main bundle, not itself lazy — never imports
    // angular-calendar/date-fns at all; that only happens once this whole
    // routes array is fetched, on first navigation to /calendar.
    path: 'calendar',
    canActivate: [authGuard],
    loadChildren: () => import('./pages/calendar/calendar.routes').then((m) => m.CALENDAR_ROUTES),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'meet-hub',
    canActivate: [authGuard],
    loadChildren: () => import('./pages/meet-hub/meet-hub.routes').then((m) => m.MEET_HUB_ROUTES),
  },
  {
    // Shareable meeting deep link — "New meeting"'s share link and
    // "Join with code" both resolve here regardless of entry point.
    // Deliberately NOT behind authGuard — MeetingLobbyComponent handles
    // both a logged-in visitor and an unauthenticated one (the guest-join
    // name-entry flow, if the meeting allows it).
    path: 'meet/:roomCode',
    loadComponent: () =>
      import('./pages/meet-hub/meeting-lobby/meeting-lobby.component').then((m) => m.MeetingLobbyComponent),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  }
];
