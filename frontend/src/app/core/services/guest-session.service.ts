import { Injectable, signal } from '@angular/core';

export interface GuestSession {
  meetingId: number;
  roomCode: string;
  guestId: number;
  guestKey: string;
  guestToken: string;
  displayName: string;
}

// Deliberately sessionStorage, not localStorage — a guest identity is
// scoped to "this tab, this visit," unlike AuthService's real session which
// intentionally persists across restarts/other tabs. Keyed per roomCode so
// a guest who's joined one meeting doesn't carry that identity into a
// different meeting link opened in the same tab.
const STORAGE_PREFIX = 'guest-session:';

@Injectable({ providedIn: 'root' })
export class GuestSessionService {
  readonly session = signal<GuestSession | null>(null);

  start(session: GuestSession) {
    this.session.set(session);
    sessionStorage.setItem(STORAGE_PREFIX + session.roomCode, JSON.stringify(session));
  }

  // Lets a page refresh while still in the lobby/call re-find the same
  // guestKey (so MeetingService.guestJoin can rejoin the same MeetingGuest
  // row) instead of silently starting a brand new one.
  restore(roomCode: string): GuestSession | null {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + roomCode);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as GuestSession;
      this.session.set(parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  clear(roomCode: string) {
    this.session.set(null);
    sessionStorage.removeItem(STORAGE_PREFIX + roomCode);
  }
}
