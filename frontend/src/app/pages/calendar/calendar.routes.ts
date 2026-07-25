import { Routes } from '@angular/router';
import { importProvidersFrom } from '@angular/core';
import { CalendarModule, DateAdapter } from 'angular-calendar';
import { adapterFactory } from 'angular-calendar/date-adapters/date-fns';

// Loaded lazily as a whole (see app.routes.ts's loadChildren) so
// angular-calendar/date-fns never reach the main bundle. The DateAdapter
// provider lives here, on the shell route itself — a route-level
// environment injector (Route.providers, Angular 14.2+) shared by the shell
// component and its day/week/month children, scoped to just this subtree.
export const CALENDAR_ROUTES: Routes = [
  {
    path: '',
    providers: [importProvidersFrom(CalendarModule.forRoot({ provide: DateAdapter, useFactory: adapterFactory }))],
    loadComponent: () => import('./calendar.component').then((m) => m.CalendarComponent),
    children: [
      { path: '', redirectTo: 'month', pathMatch: 'full' },
      { path: 'day', loadComponent: () => import('./day-view/day-view.component').then((m) => m.DayViewComponent) },
      {
        path: 'week',
        loadComponent: () => import('./week-view/week-view.component').then((m) => m.WeekViewComponent),
      },
      {
        path: 'month',
        loadComponent: () => import('./month-view/month-view.component').then((m) => m.MonthViewComponent),
      },
    ],
  },
];
