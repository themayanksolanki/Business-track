import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { MeetingService } from './meeting.service';
import { SocketService } from './socket.service';
import { WebrtcPeerService } from './webrtc-peer.service';
import { Meeting } from '../../models/meeting.model';

export interface RemoteTile {
  socketId: string;
  userId: number;
  stream: MediaStream | null;
}

// Owns the Meet Hub group-meeting mesh/session app-wide — previously this
// lived inside MeetingRoomComponent, so navigating away from /meet/:roomCode
// (e.g. to check another page) tore down every peer connection outright.
// As a root singleton this survives route changes, so the floating call
// widget (shared/call-widget) can keep the meeting alive and visible from
// any page, and returning to /meet/:roomCode re-attaches to the same
// session instead of re-joining from scratch.
@Injectable({ providedIn: 'root' })
export class MeetingSessionService {
  meeting: Meeting | null = null;
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
    private meetingSvc: MeetingService,
    private socketSvc: SocketService,
    private webrtcSvc: WebrtcPeerService,
  ) {
    this.subscribeToSocket();
  }

  get active(): boolean {
    return this.meeting !== null;
  }

  hasActiveSession(roomCode: string): boolean {
    return this.meeting?.roomCode === roomCode;
  }

  isPeerMuted(socketId: string): boolean {
    return this.mutedPeers.has(socketId);
  }

  isPeerCamOff(socketId: string): boolean {
    return this.camOffPeers.has(socketId);
  }

  join(meeting: Meeting, initialMuted: boolean, initialCamOff: boolean) {
    this.meeting     = meeting;
    this.localStream = this.webrtcSvc.getCurrentLocalStream();
    this.isMuted      = initialMuted;
    this.isCamOff     = initialCamOff;
    this.roomFull     = false;
    this.joinError    = '';

    this.meetingSvc.join(meeting.id).subscribe({
      next: ({ roomToken }) => {
        this.socketSvc.joinMeetingRoom(roomToken);
        // Carry over mute/camera state chosen in the lobby before anyone
        // else could have seen it (there was no room to broadcast into yet).
        if (this.isMuted) this.socketSvc.sendMeetingMute(meeting.id, true);
        if (this.isCamOff) this.socketSvc.sendMeetingVideoToggle(meeting.id, true);
      },
      error: () => { this.joinError = 'Could not join this meeting.'; },
    });
  }

  leave() {
    if (!this.meeting) return;
    const meetingId = this.meeting.id;
    this.socketSvc.leaveMeetingRoom(meetingId);
    this.remoteTiles.forEach((t) => this.webrtcSvc.closePeer(t.socketId));
    this.webrtcSvc.cleanupAll();
    this.meetingSvc.leave(meetingId).subscribe({ error: () => {} });

    this.meeting      = null;
    this.localStream  = null;
    this.remoteTiles  = [];
    this.isMuted      = false;
    this.isCamOff     = false;
    this.roomFull     = false;
    this.joinError    = '';
    this.mutedPeers.clear();
    this.camOffPeers.clear();
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
      })
    );
    this.subs.add(
      this.socketSvc.meetingSignal$.subscribe(async ({ fromSocketId, sdp, candidate }) => {
        if (candidate) {
          await this.webrtcSvc.addIceCandidate(fromSocketId, candidate);
          return;
        }
        if (!sdp || !this.meeting) return;
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
        if (this.meeting) this.meetingSvc.leave(this.meeting.id).subscribe({ error: () => {} });
      })
    );
    this.subs.add(
      this.socketSvc.meetingJoinError$.subscribe(({ message }) => {
        this.joinError = message;
      })
    );
    this.subs.add(
      this.socketSvc.meetingMute$.subscribe(({ socketId, muted }) => {
        if (muted) this.mutedPeers.add(socketId); else this.mutedPeers.delete(socketId);
      })
    );
    this.subs.add(
      this.socketSvc.meetingVideoToggle$.subscribe(({ socketId, off }) => {
        if (off) this.camOffPeers.add(socketId); else this.camOffPeers.delete(socketId);
      })
    );
    this.subs.add(
      this.webrtcSvc.remoteStreamAdded$.subscribe(({ peerId, stream }) => {
        const tile = this.remoteTiles.find((t) => t.socketId === peerId);
        if (tile) tile.stream = stream;
      })
    );
    // Without relaying locally-gathered ICE candidates, peers can only
    // connect using whatever candidates happen to be bundled into the
    // initial offer/answer — trickle ICE is required for real-world NATs.
    // WebrtcPeerService is shared with the 1:1 chat call (peerId 'chat'),
    // now a permanently co-resident singleton alongside this one (both
    // survive regardless of route) — filter to actual meeting peers so a
    // chat call's candidates never get relayed into a meeting by mistake.
    this.subs.add(
      this.webrtcSvc.iceCandidateReady$.subscribe(({ peerId, candidate }) => {
        if (this.meeting && this.remoteTiles.some((t) => t.socketId === peerId)) {
          this.socketSvc.sendMeetingSignal(this.meeting.id, peerId, { candidate });
        }
      })
    );
  }

  // Newly-joined socket initiates offers to each existing member it's told
  // about — avoids offer/answer glare without a separate negotiation role.
  private async connectToPeer(socketId: string, userId: number, initiate: boolean) {
    if (!this.meeting || this.webrtcSvc.hasPeer(socketId)) return;
    this.webrtcSvc.createPeer(socketId);
    this.remoteTiles.push({ socketId, userId, stream: null });

    if (initiate) {
      const offer = await this.webrtcSvc.createOffer(socketId);
      this.socketSvc.sendMeetingSignal(this.meeting.id, socketId, { sdp: offer });
    }
  }

  toggleMute() {
    if (!this.meeting) return;
    this.isMuted = !this.isMuted;
    this.webrtcSvc.setMuted(this.isMuted);
    this.socketSvc.sendMeetingMute(this.meeting.id, this.isMuted);
  }

  toggleCamera() {
    if (!this.meeting) return;
    this.isCamOff = !this.isCamOff;
    this.webrtcSvc.setCameraOff(this.isCamOff);
    this.socketSvc.sendMeetingVideoToggle(this.meeting.id, this.isCamOff);
  }
}
