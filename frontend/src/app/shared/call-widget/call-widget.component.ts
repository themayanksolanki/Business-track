import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CallSessionService } from '../../core/services/call-session.service';
import { MeetingSessionService } from '../../core/services/meeting-session.service';
import { WebrtcPeerService } from '../../core/services/webrtc-peer.service';
import { MeetingUser } from '../../models/meeting.model';
import { VideoTileComponent } from '../../pages/meet-hub/video-tile/video-tile.component';
import { NotificationService } from '../notification.service';
import { CallIconComponent } from '../call-icon/call-icon.component';

// Mounted once at the app root (see app.component.html), so it's in the DOM
// on every route — that's what lets a call/meeting started elsewhere in the
// app keep running (and stay visible, minimized into a small corner box)
// after navigating away from the page that started it. The actual session
// state lives in CallSessionService/MeetingSessionService; this component
// only owns the DOM (<video> elements) and the expanded/minimized chrome.
@Component({
  selector: 'app-call-widget',
  standalone: true,
  imports: [CommonModule, VideoTileComponent, CallIconComponent],
  templateUrl: './call-widget.component.html',
  styleUrl: './call-widget.component.css',
})
export class CallWidgetComponent implements OnInit, OnDestroy {
  @ViewChild('localVideo')  localVideo?:  ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('callOverlay') callOverlay?: ElementRef<HTMLDivElement>;

  // ── Chat call — view-local chrome (not session state, so it isn't shared
  // across components; reset whenever the call ends) ────────────────────
  chatPipSwapped = false;
  isFullscreen = false;

  private subs = new Subscription();

  constructor(
    private auth: AuthService,
    public callSvc: CallSessionService,
    public meetingSessionSvc: MeetingSessionService,
    private webrtcSvc: WebrtcPeerService,
    private router: Router,
    private notifications: NotificationService,
  ) {}

  ngOnInit() {
    this.subs.add(this.webrtcSvc.localStreamReady$.subscribe(() => this.attachLocalChat()));
    this.subs.add(
      this.webrtcSvc.remoteStreamAdded$.subscribe(({ peerId }) => {
        if (peerId === 'chat') this.attachRemoteChat();
      })
    );
    this.subs.add(
      this.callSvc.ended$.subscribe(() => {
        this.chatPipSwapped = false;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      })
    );
    // Native "Stop sharing" browser bar — CallSessionService updates
    // isScreenSharing off the same event, but the local tile's <video>
    // still needs to be pointed back at the camera stream here.
    this.subs.add(this.webrtcSvc.screenShareEnded$.subscribe(() => this.attachLocalChat()));
    document.addEventListener('fullscreenchange', this.onFullscreenChange);

    // This component is mounted at the app root — alive on every route,
    // including while the full meeting-room page is also mounted — so both
    // would otherwise show this notification at once. meeting-room.component
    // already handles it (and navigates itself away) whenever its own page
    // is the one on screen, so skip here in that case; this subscription
    // only needs to cover the minimized-mini-widget case, where the room
    // page isn't mounted to notice it itself. (meetingSessionSvc.meeting is
    // already null by the time this fires, so router.url is checked instead
    // of the meeting-derived onMeetingRoomPage getter.)
    this.subs.add(
      this.meetingSessionSvc.kicked$.subscribe(() => {
        if (this.router.url.startsWith('/meet/')) return;
        this.notifications.error('You were removed from the meeting.');
      })
    );
    this.subs.add(
      this.meetingSessionSvc.ended$.subscribe(() => {
        if (this.router.url.startsWith('/meet/')) return;
        this.notifications.success('The meeting was ended by the host.');
      })
    );
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }

  private onFullscreenChange = () => {
    this.isFullscreen = !!document.fullscreenElement;
  };

  private attachLocalChat() {
    setTimeout(() => {
      const video = this.localVideo?.nativeElement;
      // The self-view mirrors whatever's actually being sent — the shared
      // screen while presenting, the camera otherwise.
      const stream = this.callSvc.isScreenSharing
        ? this.webrtcSvc.getCurrentScreenStream()
        : this.webrtcSvc.getCurrentLocalStream();
      if (video && stream && video.srcObject !== stream) {
        video.muted = true;
        video.srcObject = stream;
        void video.play().catch(() => {});
      }
    });
  }

  async toggleScreenShare() {
    await this.callSvc.toggleScreenShare();
    this.attachLocalChat();
  }

  // The local tile only exists in the DOM while audioCallVideoOn is true, so
  // turning it on creates a brand-new <video #localVideo> element with no
  // srcObject yet — same reason toggleScreenShare() above re-attaches.
  async toggleAudioCallVideo() {
    await this.callSvc.toggleAudioCallVideo();
    this.attachLocalChat();
  }

  get screenShareSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  }

  private attachRemoteChat() {
    setTimeout(() => {
      const video = this.remoteVideo?.nativeElement;
      const stream = this.callSvc.remoteStream;
      if (video && stream && video.srcObject !== stream) {
        video.srcObject = stream;
        void video.play().catch(() => {});
      }
    });
  }

  toggleChatSwap() {
    if (this.callSvc.callType !== 'video' || this.callSvc.minimized) return;
    this.chatPipSwapped = !this.chatPipSwapped;
  }

  async toggleFullscreen() {
    const el = this.callOverlay?.nativeElement;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch { /* fullscreen unavailable or denied — ignore */ }
  }

  get myUsername(): string {
    return this.auth.getUser()?.username ?? 'You';
  }

  get myAvatarUrl(): string | null {
    return this.auth.avatarUrl(this.auth.getUser());
  }

  get remoteAvatarUrl(): string | null {
    return this.callSvc.callWithUser ? this.auth.avatarUrl(this.callSvc.callWithUser) : null;
  }

  get remoteInitial(): string {
    const name = this.callSvc.callWithUser?.username ?? this.callSvc.incomingCall?.fromName ?? '?';
    return name[0]?.toUpperCase() ?? '?';
  }

  // ── Meeting — mini floating tile shown whenever a meeting is live and
  // its full room page (/meet/:roomCode) isn't the one currently mounted ──
  get onMeetingRoomPage(): boolean {
    const meeting = this.meetingSessionSvc.meeting;
    return !!meeting && this.router.url.startsWith(`/meet/${meeting.roomCode}`);
  }

  private meetingParticipantUser(userId: number): MeetingUser | null {
    return this.meetingSessionSvc.meeting?.participants.find((p) => p.userId === userId)?.user ?? null;
  }

  get primaryMeetingTile(): { stream: MediaStream | null; label: string; user: MeetingUser | null; muted: boolean; camOff: boolean; isMobileDevice: boolean } {
    const remote = this.meetingSessionSvc.remoteTiles[0];
    if (remote) {
      return {
        stream: remote.stream,
        label: this.meetingParticipantUser(remote.userId)?.username ?? `Participant ${remote.userId}`,
        user: this.meetingParticipantUser(remote.userId),
        muted: false,
        camOff: this.meetingSessionSvc.isPeerCamOff(remote.socketId),
        isMobileDevice: this.meetingSessionSvc.isPeerMobileDevice(remote.socketId),
      };
    }
    const me = this.auth.getUser();
    return {
      stream: this.meetingSessionSvc.localStream,
      label: 'You',
      user: me ? { id: me.id, username: me.username, email: me.email, role: me.role, profileImage: me.profileImage ?? null } : null,
      muted: true,
      camOff: this.meetingSessionSvc.isCamOff,
      isMobileDevice: this.meetingSessionSvc.isMyMobileDevice,
    };
  }

  expandMeeting() {
    if (this.meetingSessionSvc.meeting) this.router.navigate(['/meet', this.meetingSessionSvc.meeting.roomCode]);
  }
}
