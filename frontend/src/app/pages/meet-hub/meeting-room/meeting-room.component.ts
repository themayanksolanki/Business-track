import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { MeetingSessionService } from '../../../core/services/meeting-session.service';
import { Meeting, MeetingUser } from '../../../models/meeting.model';
import { VideoTileComponent } from '../video-tile/video-tile.component';
import { NotificationService } from '../../../shared/notification.service';

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [CommonModule, FormsModule, VideoTileComponent],
  templateUrl: './meeting-room.component.html',
  styleUrl: './meeting-room.component.css',
})
export class MeetingRoomComponent implements OnInit, OnDestroy {
  @Input({ required: true }) meeting!: Meeting;
  @Input() initialMuted = false;
  @Input() initialCamOff = false;
  @Output() left = new EventEmitter<void>();

  @ViewChild('chatInput') chatInputRef?: ElementRef<HTMLInputElement>;

  showChatPanel = false;
  chatText = '';

  private subs = new Subscription();

  constructor(
    private auth: AuthService,
    public meetingSessionSvc: MeetingSessionService,
    private router: Router,
    private notifications: NotificationService,
  ) {}

  ngOnInit() {
    // Returning to this route after minimizing re-attaches to the still-live
    // session instead of re-joining the room from scratch.
    if (!this.meetingSessionSvc.hasActiveSession(this.meeting.roomCode)) {
      this.meetingSessionSvc.join(this.meeting, this.initialMuted, this.initialCamOff);
    }

    // These fire on the session singleton, not this component — it's the one
    // guaranteed to still be around to notice a kick/end even if this
    // component was unmounted (minimized) at the time, so it already called
    // leave() itself; this just handles the message + navigating away.
    this.subs.add(
      this.meetingSessionSvc.kicked$.subscribe(() => {
        this.notifications.error('You were removed from the meeting.');
        this.left.emit();
      })
    );
    this.subs.add(
      this.meetingSessionSvc.ended$.subscribe(() => {
        this.notifications.success('The meeting was ended by the host.');
        this.left.emit();
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
  }

  get isHost(): boolean {
    return this.meetingSessionSvc.isHost(this.auth.getUser()?.id);
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

  endMeeting() {
    if (!this.isHost) return;
    if (!confirm('End this meeting for everyone?')) return;
    this.meetingSessionSvc.endForEveryone();
  }

  kickTile(socketId: string) {
    if (!this.isHost) return;
    this.meetingSessionSvc.kickParticipant(socketId);
  }

  toggleChatPanel() {
    this.showChatPanel = !this.showChatPanel;
    if (this.showChatPanel) setTimeout(() => this.chatInputRef?.nativeElement.focus());
  }

  sendChat() {
    const text = this.chatText.trim();
    if (!text) return;
    this.meetingSessionSvc.sendChatMessage(text);
    this.chatText = '';
  }

  chatSenderLabel(userId: number): string {
    if (userId === this.myUser?.id) return 'You';
    return this.participantLabel(userId);
  }
}
