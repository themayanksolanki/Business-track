import { Injectable, signal } from '@angular/core';

// Counter-based instead of a plain boolean so overlapping requests don't
// race each other into hiding the loader early (request A finishing
// shouldn't hide it while request B is still in flight).
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private count = 0;
  private readonly _visible = signal(false);
  readonly visible = this._visible.asReadonly();

  private showTimer: ReturnType<typeof setTimeout> | null = null;

  start() {
    this.count++;
    // Short delay before showing so fast requests don't flash the overlay.
    if (this.count === 1 && !this.showTimer) {
      this.showTimer = setTimeout(() => {
        this.showTimer = null;
        if (this.count > 0) this._visible.set(true);
      }, 150);
    }
  }

  stop() {
    this.count = Math.max(0, this.count - 1);
    if (this.count === 0) {
      if (this.showTimer) {
        clearTimeout(this.showTimer);
        this.showTimer = null;
      }
      this._visible.set(false);
    }
  }
}
