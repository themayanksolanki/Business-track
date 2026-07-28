import { Routes } from '@angular/router';

export const MEET_HUB_ROUTES: Routes = [
  { path: '', loadComponent: () => import('./meet-hub.component').then((m) => m.MeetHubComponent) },
];
