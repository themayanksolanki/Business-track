import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { MeetingSessionService } from '../../../core/services/meeting-session.service';
import { Meeting, MeetingUser } from '../../../models/meeting.model';
import { VideoTileComponent } from '../video-tile/video-tile.component';

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [CommonModule, VideoTileComponent],
  templateUrl: './meeting-room.component.html',
  styleUrl: './meeting-room.component.css',
})
export class MeetingRoomComponent implements OnInit {
  @Input({ required: true }) meeting!: Meeting;
  @Input() initialMuted = false;
  @Input() initialCamOff = false;
  @Output() left = new EventEmitter<void>();

  constructor(
    private auth: AuthService,
    public meetingSessionSvc: MeetingSessionService,
    private router: Router,
  ) {}

  ngOnInit() {
    // Returning to this route after minimizing re-attaches to the still-live
    // session instead of re-joining the room from scratch.
    if (!this.meetingSessionSvc.hasActiveSession(this.meeting.roomCode)) {
      this.meetingSessionSvc.join(this.meeting, this.initialMuted, this.initialCamOff);
    }
  }

  get myUsername(): string {
    return this.auth.getUser()?.username ?? 'You';
  }

  get myUser(): MeetingUser | null {
    const me = this.auth.getUser();
    if (!me) return null;
    return { id: me.id, username: me.username, email: me.email, role: me.role, profileImage: me.profileImage ?? null };
  }

  participantUser(userId: number): MeetingUser | null {
    return this.meeting.participants.find((p) => p.userId === userId)?.user ?? null;
  }

  participantLabel(userId: number): string {
    return this.participantUser(userId)?.username ?? `Participant ${userId}`;
  }

  // Steps back out of the full-screen room to wherever the widget's
  // "expand" will return to — the call keeps running via
  // MeetingSessionService regardless of route, so the floating widget
  // (shared/call-widget) picks it up the moment this route unmounts.
  minimize() {
    this.router.navigate(['/meet-hub']);
  }

  leaveMeeting() {
    this.meetingSessionSvc.leave();
    this.left.emit();
  }
}
