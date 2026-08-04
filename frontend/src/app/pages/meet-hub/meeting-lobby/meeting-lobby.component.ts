import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import * as QRCode from 'qrcode';
import { MeetingService } from '../../../core/services/meeting.service';
import { ChatService } from '../../../core/services/chat.service';
import { WebrtcPeerService } from '../../../core/services/webrtc-peer.service';
import { MeetingSessionService } from '../../../core/services/meeting-session.service';
import { SocketService } from '../../../core/services/socket.service';
import { GuestSessionService } from '../../../core/services/guest-session.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../shared/notification.service';
import { Meeting, PublicMeetingInfo } from '../../../models/meeting.model';
import { MeetingRoomComponent } from '../meeting-room/meeting-room.component';

@Component({
  selector: 'app-meeting-lobby',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MeetingRoomComponent],
  templateUrl: './meeting-lobby.component.html',
  styleUrl: './meeting-lobby.component.css',
})
export class MeetingLobbyComponent implements OnInit, OnDestroy {
  @ViewChild('previewVideo') previewVideo!: ElementRef<HTMLVideoElement>;

  meeting: Meeting | null = null;
  loading = true;
  error = '';
  showLoginPrompt = false;
  joined = false;
  isMuted = false;
  isCamOff = false;

  cameras: MediaDeviceInfo[] = [];
  microphones: MediaDeviceInfo[] = [];
  selectedCameraId = '';
  selectedMicId = '';
  showDevicePicker = false;
  switchingDevice = false;

  // ── Guest (no-account) join ──────────────────────────────────────────
  isGuestFlow = false;
  publicInfo: PublicMeetingInfo | null = null;
  guestDisplayNameInput = '';
  guestJoinError = '';
  guestToken: string | null = null;
  guestDisplayName: string | null = null;
  // A guest backing out or leaving has nowhere authenticated to navigate to
  // (/meet-hub would just bounce them straight to /login) — this shows a
  // standalone "you've left" state instead of navigating anywhere.
  guestLeftMeeting = false;
  savingGuestSetting = false;

  // ── Share link (copy + QR) — shown to everyone in the lobby ──────────
  shareUrl = '';
  qrDataUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private meetingSvc: MeetingService,
    // ICE server config is shared across all WebRTC features — reusing the
    // existing chat endpoint rather than duplicating it under /meetings.
    private chatSvc: ChatService,
    private webrtcSvc: WebrtcPeerService,
    private meetingSessionSvc: MeetingSessionService,
    private socketSvc: SocketService,
    private guestSessionSvc: GuestSessionService,
    private auth: AuthService,
    private notifications: NotificationService,
  ) {}

  ngOnInit() {
    const roomCode = this.route.snapshot.paramMap.get('roomCode')!;
    const loggedIn = this.auth.isLoggedIn();

    // A guest has no JWT — calling the protected /ice-servers endpoint would
    // 401 and (via the global auth interceptor's session-expiry handling)
    // bounce them straight to /login before they ever see the join screen.
    (loggedIn ? this.chatSvc.getIceServers() : this.chatSvc.getPublicIceServers()).subscribe({
      next: ({ iceServers }) => this.webrtcSvc.setIceServers(iceServers),
    });

    if (loggedIn) {
      this.loadAuthenticated(roomCode);
    } else {
      this.loadPublic(roomCode);
    }
  }

  private loadAuthenticated(roomCode: string) {
    this.meetingSvc.getByRoomCode(roomCode).subscribe({
      next: (meeting) => {
        this.meeting = meeting;
        this.loading = false;
        this.setupShare(roomCode);

        // Returning here after minimizing (or any other in-app navigation)
        // while this meeting is still live — re-attach to it directly
        // instead of re-requesting camera/mic access and re-joining.
        if (this.meetingSessionSvc.hasActiveSession(roomCode)) {
          this.isMuted  = this.meetingSessionSvc.isMuted;
          this.isCamOff = this.meetingSessionSvc.isCamOff;
          this.joined   = true;
          return;
        }
        this.startPreview();
      },
      error: () => {
        this.error = 'Meeting not found or you do not have access to it.';
        this.loading = false;
      },
    });
  }

  private loadPublic(roomCode: string) {
    this.isGuestFlow = true;
    this.meetingSvc.getPublicInfo(roomCode).subscribe({
      next: (info) => {
        this.publicInfo = info;
        this.loading = false;
        this.setupShare(roomCode);

        if (!info.allowExternalGuests) {
          this.error = "This meeting doesn't allow guest access.";
          this.showLoginPrompt = true;
          return;
        }

        // A page refresh while still in the guest lobby/call reuses the
        // same guestKey (so the backend upserts the same MeetingGuest row)
        // and skips straight past the name prompt, since they already gave
        // it once this session.
        const restored = this.guestSessionSvc.restore(roomCode);
        if (restored) {
          this.completeGuestJoin(roomCode, restored.displayName, restored.guestKey);
        }
      },
      error: () => {
        this.error = 'Meeting not found.';
        this.loading = false;
      },
    });
  }

  submitGuestName() {
    const name = this.guestDisplayNameInput.trim();
    if (!name) {
      this.guestJoinError = 'Please enter your name.';
      return;
    }
    const roomCode = this.route.snapshot.paramMap.get('roomCode')!;
    this.completeGuestJoin(roomCode, name);
  }

  private completeGuestJoin(roomCode: string, displayName: string, guestKey?: string) {
    this.guestJoinError = '';
    this.meetingSvc.guestJoin(roomCode, displayName, guestKey).subscribe({
      next: (res) => {
        this.guestToken = res.guestToken;
        this.guestDisplayName = res.displayName;
        this.guestSessionSvc.start({
          meetingId: res.meetingId,
          roomCode,
          guestId: res.guestId,
          guestKey: res.guestKey,
          guestToken: res.guestToken,
          displayName: res.displayName,
        });
        this.meeting = this.buildGuestMeeting(res.meetingId, roomCode);
        this.socketSvc.connect(res.guestToken);
        this.startPreview();
      },
      error: (err) => {
        this.guestJoinError = err.error?.message || 'Could not join this meeting.';
      },
    });
  }

  // A guest's own REST responses (getPublicInfo/guestJoin) deliberately
  // never include the full authenticated Meeting shape (host id, real
  // participants, settings) — this reconstructs just enough of it for
  // MeetingSessionService/MeetingRoomComponent to operate on unchanged.
  // hostId: -1 is a sentinel that can never match a real user id, so
  // isHost()/kick-permission checks correctly stay false for a guest viewer.
  private buildGuestMeeting(meetingId: number, roomCode: string): Meeting {
    const info = this.publicInfo!;
    const now = new Date().toISOString();
    return {
      id: meetingId,
      sequenceId: null,
      roomCode,
      title: info.title,
      hostId: -1,
      organizationId: null,
      callType: info.callType,
      status: info.status,
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      endedAt: null,
      calendarEventId: null,
      projectId: null,
      groupId: null,
      createdAt: now,
      updatedAt: now,
      host: { id: -1, username: info.hostName, email: '', role: '', profileImage: null },
      settings: null,
      participants: [],
      calendarEvent: null,
      project: null,
      group: null,
    };
  }

  private setupShare(roomCode: string) {
    this.shareUrl = `${window.location.origin}/meet/${roomCode}`;
    QRCode.toDataURL(this.shareUrl, { width: 220, margin: 1 })
      .then((url: string) => { this.qrDataUrl = url; })
      .catch(() => { /* non-critical — copy link still works without a QR */ });
  }

  copyLink() {
    navigator.clipboard.writeText(this.shareUrl).then(
      () => this.notifications.success('Meeting link copied'),
      () => this.notifications.error('Failed to copy link'),
    );
  }

  get isHostViewer(): boolean {
    return !!this.meeting && this.meeting.hostId === this.auth.getUser()?.id;
  }

  toggleAllowExternalGuests(checked: boolean) {
    // Mirrors meeting-room.component.ts's endMeeting()/kickTile() convention
    // — the template already hides this control unless isHostViewer, but
    // the method double-checks too rather than relying on that alone.
    if (!this.meeting || !this.isHostViewer || this.savingGuestSetting) return;
    this.savingGuestSetting = true;
    this.meetingSvc.update(this.meeting.id, { settings: { allowExternalGuests: checked } }).subscribe({
      next: (res) => { this.meeting = res.meeting; this.savingGuestSetting = false; },
      error: () => { this.savingGuestSetting = false; },
    });
  }

  get currentUrl(): string {
    return this.router.url;
  }

  ngOnDestroy() {
    if (!this.joined) {
      this.webrtcSvc.stopLocalStream();
      // A guest's socket exists only because this component explicitly
      // connected it after guestJoin() — unlike a real user's app-wide
      // socket (owned by AppComponent regardless of this page), nothing
      // else will disconnect it if they navigate away having only
      // previewed their camera without ever actually joining the room.
      if (this.isGuestFlow && this.guestToken) this.socketSvc.disconnect();
    }
  }

  private async startPreview() {
    try {
      const stream = await this.webrtcSvc.getLocalStream({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: this.meeting?.callType !== 'audio',
      });
      this.attachPreview(stream);
      // Labelled device names only become readable after permission is
      // granted (the getUserMedia call above) — enumerating any earlier
      // would show blank labels.
      void this.loadDevices();
    } catch {
      this.error = 'Could not access your camera or microphone.';
    }
  }

  private attachPreview(stream: MediaStream) {
    setTimeout(() => {
      const video = this.previewVideo?.nativeElement;
      if (video) {
        video.muted = true;
        video.srcObject = stream;
        void video.play().catch(() => {});
      }
    });
  }

  private async loadDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.cameras = devices.filter((d) => d.kind === 'videoinput');
    this.microphones = devices.filter((d) => d.kind === 'audioinput');
    const currentStream = this.webrtcSvc.getCurrentLocalStream();
    this.selectedCameraId = currentStream?.getVideoTracks()[0]?.getSettings().deviceId ?? this.cameras[0]?.deviceId ?? '';
    this.selectedMicId = currentStream?.getAudioTracks()[0]?.getSettings().deviceId ?? this.microphones[0]?.deviceId ?? '';
  }

  toggleDevicePicker() {
    this.showDevicePicker = !this.showDevicePicker;
  }

  // Re-acquires the local stream against the chosen device(s) — simplest
  // correct approach pre-join (no peer connections exist yet to renegotiate
  // against), unlike swapping devices mid-call which would need the same
  // replaceTrack() machinery screen-share uses.
  async applyDeviceSelection() {
    // Guards join() below — the room mounts against
    // webrtcSvc.getCurrentLocalStream() as soon as joined flips true, and
    // that stream is briefly null between the stopLocalStream() and the
    // getLocalStream() resolving. Joining into that gap would start peer
    // connections with no local tracks at all.
    this.switchingDevice = true;
    this.webrtcSvc.stopLocalStream();
    try {
      const stream = await this.webrtcSvc.getLocalStream({
        audio: this.selectedMicId ? { deviceId: { exact: this.selectedMicId } } : true,
        video: this.meeting?.callType !== 'audio'
          ? (this.selectedCameraId ? { deviceId: { exact: this.selectedCameraId } } : true)
          : false,
      });
      this.webrtcSvc.setMuted(this.isMuted);
      this.webrtcSvc.setCameraOff(this.isCamOff);
      this.attachPreview(stream);
    } catch {
      this.error = 'Could not switch to the selected device.';
    } finally {
      this.switchingDevice = false;
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.webrtcSvc.setMuted(this.isMuted);
  }

  toggleCamera() {
    this.isCamOff = !this.isCamOff;
    this.webrtcSvc.setCameraOff(this.isCamOff);
  }

  join() {
    if (this.switchingDevice) return;
    this.joined = true;
  }

  // Only the host of a meeting nobody has joined yet actually deletes it on
  // the way out — a non-host backing out, or a meeting that's already live
  // because someone else joined first, just leaves the room running and
  // navigates away instead (there's nothing of theirs to cancel). Always
  // false for a guest (no auth.getUser()), same as before.
  get canCancelMeeting(): boolean {
    return !!this.meeting && this.meeting.status === 'scheduled' && this.meeting.hostId === this.auth.getUser()?.id;
  }

  // Backs out of a meeting created moments ago (e.g. "New meeting" clicked
  // by mistake, or changed your mind before joining) — previously there was
  // no way to do this short of leaving it as an orphaned "scheduled" row.
  leaveLobby() {
    this.webrtcSvc.stopLocalStream();
    if (this.canCancelMeeting) {
      this.meetingSvc.cancel(this.meeting!.id).subscribe({ next: () => {}, error: () => {} });
    }
    // /meet-hub requires a real account — a guest backing out has nowhere
    // authenticated to go, so this just shows the "left" state in place.
    if (this.isGuestFlow) {
      this.guestLeftMeeting = true;
      return;
    }
    this.router.navigate(['/meet-hub']);
  }

  onLeft() {
    this.joined = false;
    if (this.isGuestFlow) {
      const roomCode = this.route.snapshot.paramMap.get('roomCode')!;
      this.guestSessionSvc.clear(roomCode);
      this.guestLeftMeeting = true;
      return;
    }
    this.router.navigate(['/meet-hub']);
  }

  meetingLabel(): string {
    if (!this.meeting) return '';
    return this.meeting.title || `Meeting with ${this.meeting.host.username}`;
  }
}
