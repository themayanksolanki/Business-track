import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingService } from '../../../core/services/meeting.service';
import { ChatService } from '../../../core/services/chat.service';
import { WebrtcPeerService } from '../../../core/services/webrtc-peer.service';
import { Meeting } from '../../../models/meeting.model';
import { MeetingRoomComponent } from '../meeting-room/meeting-room.component';

@Component({
  selector: 'app-meeting-lobby',
  standalone: true,
  imports: [CommonModule, MeetingRoomComponent],
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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private meetingSvc: MeetingService,
    // ICE server config is shared across all WebRTC features — reusing the
    // existing chat endpoint rather than duplicating it under /meetings.
    private chatSvc: ChatService,
    private webrtcSvc: WebrtcPeerService,
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
      setTimeout(() => {
        const video = this.previewVideo?.nativeElement;
        if (video) {
          video.muted = true;
          video.srcObject = stream;
          void video.play().catch(() => {});
        }
      });
    } catch {
      this.error = 'Could not access your camera or microphone.';
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
    this.joined = true;
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
