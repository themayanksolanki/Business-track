import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'app-theme';
  readonly theme = signal<Theme>(this.load());

  constructor() {
    this.apply(this.theme());
  }

  set(theme: Theme) {
    this.theme.set(theme);
    localStorage.setItem(this.KEY, theme);
    this.apply(theme);
  }

  toggle() {
    this.set(this.theme() === 'light' ? 'dark' : 'light');
  }

  private load(): Theme {
    const saved = localStorage.getItem(this.KEY) as Theme | null;
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private apply(theme: Theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-bs-theme', theme);
  }
}
