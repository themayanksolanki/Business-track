import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Meeting, MeetingParticipant, MeetingSettings } from '../../models/meeting.model';

@Injectable({ providedIn: 'root' })
export class MeetingService {
  private readonly api = `${environment.apiUrl}/meetings`;

  constructor(private http: HttpClient) {}

  create(payload: { title?: string; callType?: 'audio' | 'video'; scheduledStart?: string; scheduledEnd?: string }) {
    return this.http.post<{ message: string; meeting: Meeting }>(this.api, payload);
  }

  getByRoomCode(roomCode: string) {
    return this.http.get<Meeting>(`${this.api}/${roomCode}`);
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
