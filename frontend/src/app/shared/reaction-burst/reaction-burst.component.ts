import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface ReactionParticle {
  id: number;
  emoji: string;
  leftPercent: number;
  driftPx: string;
  durationMs: string;
}

// Mounted once, absolutely positioned over a call surface (call-widget's
// overlay, meeting-room's stage) — burst() is called imperatively (via
// @ViewChild) whenever a reaction is sent or received, both locally and over
// the socket. Purely a rendering layer: no socket/session knowledge of its
// own, so the same component works for both the 1:1 call and the group
// meeting room without duplicating the float/fade animation twice.
@Component({
  selector: 'app-reaction-burst',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './reaction-burst.component.html',
  styleUrl: './reaction-burst.component.css',
})
export class ReactionBurstComponent {
  particles: ReactionParticle[] = [];
  private nextId = 0;

  burst(emoji: string) {
    const id = this.nextId++;
    // Random horizontal start/drift/duration per particle so a run of the
    // same emoji (or several different ones) doesn't stack in an identical
    // column — mirrors the loose, staggered look of Zoom/Meet reactions.
    const leftPercent = 38 + Math.random() * 24; // 38%-62%
    const driftPx = `${Math.round((Math.random() - 0.5) * 140)}px`; // -70..+70
    const durationMs = `${2200 + Math.round(Math.random() * 900)}ms`; // 2.2s-3.1s
    this.particles.push({ id, emoji, leftPercent, driftPx, durationMs });

    // Matches the animation-duration above (plus a small buffer) — the
    // particle removes itself once it's fully faded rather than relying on
    // an `animationend` listener per element.
    setTimeout(() => {
      this.particles = this.particles.filter((p) => p.id !== id);
    }, parseInt(durationMs, 10) + 150);
  }
}
