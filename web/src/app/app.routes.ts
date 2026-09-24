import { Routes } from '@angular/router';
import { setupGuard } from './core/setup.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'jobs' },
  {
    path: 'setup',
    title: 'Set up · JobPilot',
    loadComponent: () => import('./features/setup/setup-page').then((m) => m.SetupPage),
  },
  {
    path: 'jobs',
    title: 'Matches · JobPilot',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/jobs/jobs-page').then((m) => m.JobsPage),
  },
  {
    path: 'pipeline',
    title: 'Pipeline · JobPilot',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/pipeline/pipeline-page').then((m) => m.PipelinePage),
  },
  {
    path: 'applications',
    title: 'Applications · JobPilot',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/applications/applications-page').then((m) => m.ApplicationsPage),
  },
  {
    path: 'applications/:id',
    title: 'Application · JobPilot',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/applications/application-detail').then((m) => m.ApplicationDetail),
  },
  {
    path: 'runs',
    title: 'Sweeps · JobPilot',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/runs/runs-page').then((m) => m.RunsPage),
  },
  {
    path: 'settings',
    title: 'Settings · JobPilot',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: 'jobs' },
];
