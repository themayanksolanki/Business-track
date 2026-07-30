import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingService } from '../../../core/services/meeting.service';
import { ChatService } from '../../../core/services/chat.service';
import { WebrtcPeerService } from '../../../core/services/webrtc-peer.service';
import { MeetingSessionService } from '../../../core/services/meeting-session.service';
import { AuthService } from '../../../core/services/auth.service';
import { Meeting } from '../../../models/meeting.model';
import { MeetingRoomComponent } from '../meeting-room/meeting-room.component';

@Component({
  selector: 'app-meeting-lobby',
  standalone: true,
  imports: [CommonModule, FormsModule, MeetingRoomComponent],
  templateUrl: './meeting-lobby.component.html',
  styleUrl: './meeting-lobby.component.css',
})
export class MeetingLobbyComponent implements OnInit, OnDestroy {
  @ViewChild('previewVideo') previewVideo!: ElementRef<HTMLVideoElement>;

  meeting: Meeting | null = null;
  loading = true;
  error = '';
  joined = false;
  isMuted = false;
  isCamOff = false;

  cameras: MediaDeviceInfo[] = [];
  microphones: MediaDeviceInfo[] = [];
  selectedCameraId = '';
  selectedMicId = '';
  showDevicePicker = false;
  switchingDevice = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private meetingSvc: MeetingService,
    // ICE server config is shared across all WebRTC features — reusing the
    // existing chat endpoint rather than duplicating it under /meetings.
    private chatSvc: ChatService,
    private webrtcSvc: WebrtcPeerService,
    private meetingSessionSvc: MeetingSessionService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    const roomCode = this.route.snapshot.paramMap.get('roomCode')!;

    this.chatSvc.getIceServers().subscribe({
      next: ({ iceServers }) => this.webrtcSvc.setIceServers(iceServers),
    });

    this.meetingSvc.getByRoomCode(roomCode).subscribe({
      next: (meeting) => {
        this.meeting = meeting;
        this.loading = false;

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

  ngOnDestroy() {
    if (!this.joined) this.webrtcSvc.stopLocalStream();
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
  // navigates away instead (there's nothing of theirs to cancel).
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
    this.router.navigate(['/meet-hub']);
  }

  onLeft() {
    this.joined = false;
    this.router.navigate(['/meet-hub']);
  }

  meetingLabel(): string {
    if (!this.meeting) return '';
    return this.meeting.title || `Meeting with ${this.meeting.host.username}`;
  }
}
