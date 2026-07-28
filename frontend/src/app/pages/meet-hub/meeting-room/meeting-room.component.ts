import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { MeetingService } from '../../../core/services/meeting.service';
import { SocketService } from '../../../core/services/socket.service';
import { WebrtcPeerService } from '../../../core/services/webrtc-peer.service';
import { Meeting } from '../../../models/meeting.model';
import { VideoTileComponent } from '../video-tile/video-tile.component';

interface RemoteTile {
  socketId: string;
  userId: number;
  stream: MediaStream | null;
}

@Component({
  selector: 'app-meeting-room',
  standalone: true,
  imports: [CommonModule, VideoTileComponent],
  templateUrl: './meeting-room.component.html',
  styleUrl: './meeting-room.component.css',
})
export class MeetingRoomComponent implements OnInit, OnDestroy {
  @Input({ required: true }) meeting!: Meeting;
  @Input() initialMuted = false;
  @Input() initialCamOff = false;
  @Output() left = new EventEmitter<void>();

  localStream: MediaStream | null = null;
  remoteTiles: RemoteTile[] = [];
  isMuted = false;
  isCamOff = false;
  roomFull = false;
  joinError = '';

  private mutedPeers = new Set<string>();
  private camOffPeers = new Set<string>();
  private subs = new Subscription();

  constructor(
    private auth: AuthService,
    private meetingSvc: MeetingService,
    private socketSvc: SocketService,
    private webrtcSvc: WebrtcPeerService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.localStream = this.webrtcSvc.getCurrentLocalStream();
    this.isMuted = this.initialMuted;
    this.isCamOff = this.initialCamOff;
    this.subscribeToSocket();

    this.meetingSvc.join(this.meeting.id).subscribe({
      next: ({ roomToken }) => {
        this.socketSvc.joinMeetingRoom(roomToken);
        // Carry over mute/camera state chosen in the lobby before anyone
        // else could have seen it (there was no room to broadcast into yet).
        if (this.isMuted) this.socketSvc.sendMeetingMute(this.meeting.id, true);
        if (this.isCamOff) this.socketSvc.sendMeetingVideoToggle(this.meeting.id, true);
      },
      error: () => { this.joinError = 'Could not join this meeting.'; this.cdr.detectChanges(); },
    });
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.socketSvc.leaveMeetingRoom(this.meeting.id);
    this.remoteTiles.forEach((t) => this.webrtcSvc.closePeer(t.socketId));
    this.webrtcSvc.cleanupAll();
    this.meetingSvc.leave(this.meeting.id).subscribe({ error: () => {} });
  }

  get myUsername(): string {
    return this.auth.getUser()?.username ?? 'You';
  }

  isPeerMuted(socketId: string): boolean {
    return this.mutedPeers.has(socketId);
  }

  isPeerCamOff(socketId: string): boolean {
    return this.camOffPeers.has(socketId);
  }

  private subscribeToSocket() {
    this.subs.add(
      this.socketSvc.meetingJoined$.subscribe(({ members }) => {
        members.forEach((m) => this.connectToPeer(m.socketId, m.userId, true));
      })
    );
    this.subs.add(
      this.socketSvc.meetingParticipantJoined$.subscribe(({ socketId, userId }) => {
        this.connectToPeer(socketId, userId, false);
      })
    );
    this.subs.add(
      this.socketSvc.meetingParticipantLeft$.subscribe(({ socketId }) => {
        this.webrtcSvc.closePeer(socketId);
        this.mutedPeers.delete(socketId);
        this.camOffPeers.delete(socketId);
        this.remoteTiles = this.remoteTiles.filter((t) => t.socketId !== socketId);
        this.cdr.detectChanges();
      })
    );
    this.subs.add(
      this.socketSvc.meetingSignal$.subscribe(async ({ fromSocketId, sdp, candidate }) => {
        if (candidate) {
          await this.webrtcSvc.addIceCandidate(fromSocketId, candidate);
          return;
        }
        if (!sdp) return;
        if (sdp.type === 'offer') {
          if (!this.webrtcSvc.hasPeer(fromSocketId)) this.webrtcSvc.createPeer(fromSocketId);
          const answer = await this.webrtcSvc.createAnswer(fromSocketId, sdp);
          this.socketSvc.sendMeetingSignal(this.meeting.id, fromSocketId, { sdp: answer });
        } else if (sdp.type === 'answer') {
          await this.webrtcSvc.setRemoteAnswer(fromSocketId, sdp);
        }
      })
    );
    this.subs.add(
      this.socketSvc.meetingRoomFull$.subscribe(() => {
        this.roomFull = true;
        // REST /join already recorded us as a participant before we knew the
        // socket room was full — undo that so we don't look "joined" with no
        // actual presence in the mesh.
        this.meetingSvc.leave(this.meeting.id).subscribe({ error: () => {} });
        this.cdr.detectChanges();
      })
    );
    this.subs.add(
      this.socketSvc.meetingJoinError$.subscribe(({ message }) => {
        this.joinError = message;
        this.cdr.detectChanges();
      })
    );
    this.subs.add(
      this.socketSvc.meetingMute$.subscribe(({ socketId, muted }) => {
        if (muted) this.mutedPeers.add(socketId); else this.mutedPeers.delete(socketId);
        this.cdr.detectChanges();
      })
    );
    this.subs.add(
      this.socketSvc.meetingVideoToggle$.subscribe(({ socketId, off }) => {
        if (off) this.camOffPeers.add(socketId); else this.camOffPeers.delete(socketId);
        this.cdr.detectChanges();
      })
    );
    this.subs.add(
      this.webrtcSvc.remoteStreamAdded$.subscribe(({ peerId, stream }) => {
        const tile = this.remoteTiles.find((t) => t.socketId === peerId);
        if (tile) tile.stream = stream;
        this.cdr.detectChanges();
      })
    );
    // Without relaying locally-gathered ICE candidates, peers can only
    // connect using whatever candidates happen to be bundled into the
    // initial offer/answer — trickle ICE is required for real-world NATs.
    this.subs.add(
      this.webrtcSvc.iceCandidateReady$.subscribe(({ peerId, candidate }) => {
        this.socketSvc.sendMeetingSignal(this.meeting.id, peerId, { candidate });
      })
    );
  }

  // Newly-joined socket initiates offers to each existing member it's told
  // about — avoids offer/answer glare without a separate negotiation role.
  private async connectToPeer(socketId: string, userId: number, initiate: boolean) {
    if (this.webrtcSvc.hasPeer(socketId)) return;
    this.webrtcSvc.createPeer(socketId);
    this.remoteTiles.push({ socketId, userId, stream: null });
    this.cdr.detectChanges();

    if (initiate) {
      const offer = await this.webrtcSvc.createOffer(socketId);
      this.socketSvc.sendMeetingSignal(this.meeting.id, socketId, { sdp: offer });
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.webrtcSvc.setMuted(this.isMuted);
    this.socketSvc.sendMeetingMute(this.meeting.id, this.isMuted);
  }

  toggleCamera() {
    this.isCamOff = !this.isCamOff;
    this.webrtcSvc.setCameraOff(this.isCamOff);
    this.socketSvc.sendMeetingVideoToggle(this.meeting.id, this.isCamOff);
  }

  leaveMeeting() {
    this.left.emit();
  }
}
