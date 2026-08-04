import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Meeting, MeetingParticipant, MeetingSettings, PublicMeetingInfo } from '../../models/meeting.model';

@Injectable({ providedIn: 'root' })
export class MeetingService {
  private readonly api = `${environment.apiUrl}/meetings`;

  constructor(private http: HttpClient) {}

  create(payload: {
    title?: string;
    callType?: 'audio' | 'video';
    scheduledStart?: string;
    scheduledEnd?: string;
    calendarEventId?: number;
    projectId?: number;
    groupId?: number;
  }) {
    return this.http.post<{ message: string; meeting: Meeting }>(this.api, payload);
  }

  getByRoomCode(roomCode: string) {
    return this.http.get<Meeting>(`${this.api}/${roomCode}`);
  }

  // Unauthenticated (no Authorization header needed/sent — the interceptor
  // only attaches one when a token exists, so a logged-out call here is a
  // non-issue) — backs the guest pre-join screen in MeetingLobbyComponent.
  getPublicInfo(roomCode: string) {
    return this.http.get<PublicMeetingInfo>(`${this.api}/public/${roomCode}/info`);
  }

  // `guestKey` is only passed on a rejoin (e.g. a page refresh while still
  // in the lobby/call) so the backend reuses the same MeetingGuest row
  // instead of creating a new one — see GuestSessionService.
  guestJoin(roomCode: string, displayName: string, guestKey?: string) {
    return this.http.post<{
      message: string;
      meetingId: number;
      guestId: number;
      guestKey: string;
      displayName: string;
      guestToken: string;
    }>(`${this.api}/public/${roomCode}/guest-join`, { displayName, guestKey });
  }

  join(id: number) {
    return this.http.post<{ message: string; meeting: Meeting; roomToken: string }>(`${this.api}/${id}/join`, {});
  }

  leave(id: number) {
    return this.http.post<{ message: string }>(`${this.api}/${id}/leave`, {});
  }

  end(id: number) {
    return this.http.post<{ message: string }>(`${this.api}/${id}/end`, {});
  }

  update(
    id: number,
    payload: Partial<{
      title: string;
      scheduledStart: string;
      scheduledEnd: string;
      settings: Partial<MeetingSettings>;
    }>
  ) {
    return this.http.patch<{ message: string; meeting: Meeting }>(`${this.api}/${id}`, payload);
  }

  cancel(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }

  getUpcoming() {
    return this.http.get<Meeting[]>(`${this.api}/upcoming`);
  }

  getHistory(id: number) {
    return this.http.get<{
      meetingId: number;
      participants: (MeetingParticipant & { durationSeconds: number | null })[];
    }>(`${this.api}/${id}/history`);
  }
}
