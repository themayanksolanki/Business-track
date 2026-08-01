import { Injectable } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { MeetingService } from './meeting.service';
import { SocketService } from './socket.service';
import { WebrtcPeerService } from './webrtc-peer.service';
import { Meeting } from '../../models/meeting.model';
import { isMobileDevice } from '../../shared/utils/device.util';

export interface RemoteTile {
  socketId: string;
  userId: number;
  stream: MediaStream | null;
}

export interface MeetingChatEntry {
  socketId: string;
  userId: number;
  message: string;
  at: string;
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
  isScreenSharing = false;
  handRaised = false;
  chatMessages: MeetingChatEntry[] = [];
  // See device.util.ts's isMobileDevice() — sent once per join (see join()
  // below), not toggled like mute/camera/screen-share.
  readonly isMyMobileDevice = isMobileDevice();

  // Fire when this client itself is removed from the session — the
  // component/floating widget subscribes to show a message and navigate
  // away, since this service (not any one component) is what's guaranteed
  // to still be alive to notice it (see the class-level comment on why this
  // is a root singleton).
  readonly kicked$ = new Subject<void>();
  readonly ended$  = new Subject<void>();

  private mutedPeers = new Set<string>();
  private camOffPeers = new Set<string>();
  private screenSharingPeers = new Set<string>();
  private raisedHandPeers = new Set<string>();
  private mobileDevicePeers = new Set<string>();
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

  isPeerScreenSharing(socketId: string): boolean {
    return this.screenSharingPeers.has(socketId);
  }

  isPeerHandRaised(socketId: string): boolean {
    return this.raisedHandPeers.has(socketId);
  }

  isPeerMobileDevice(socketId: string): boolean {
    return this.mobileDevicePeers.has(socketId);
  }

  isHost(userId: number | undefined): boolean {
    return !!userId && this.meeting?.hostId === userId;
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
        if (this.isMyMobileDevice) this.socketSvc.sendMeetingMobileDevice(meeting.id, true);
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

    this.meeting        = null;
    this.localStream    = null;
    this.remoteTiles    = [];
    this.isMuted        = false;
    this.isCamOff       = false;
    this.roomFull       = false;
    this.joinError      = '';
    this.isScreenSharing = false;
    this.handRaised     = false;
    this.chatMessages   = [];
    this.mutedPeers.clear();
    this.camOffPeers.clear();
    this.screenSharingPeers.clear();
    this.raisedHandPeers.clear();
    this.mobileDevicePeers.clear();
  }

  // Host action — ends the meeting for everyone, not just this client.
  // The REST call is the durable status flip; the socket emit is purely the
  // real-time "leave now" fan-out (see socket.ts's meeting:end handler),
  // which comes back around to this same client too (ended$ below), so
  // there's no separate "I ended it" cleanup path to maintain.
  endForEveryone() {
    if (!this.meeting) return;
    this.meetingSvc.end(this.meeting.id).subscribe({ error: () => {} });
    this.socketSvc.endMeetingForEveryone(this.meeting.id);
  }

  kickParticipant(socketId: string) {
    if (!this.meeting) return;
    this.socketSvc.kickMeetingParticipant(this.meeting.id, socketId);
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
        this.mobileDevicePeers.delete(socketId);
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
          // reserveVideoSlot: true — matches connectToPeer's call below. This
          // branch is a defensive fallback (normally connectToPeer already
          // created the peer before any signal arrives), but if an offer
          // ever does race ahead of that, the peer still needs a reserved
          // video sender or screen-share silently can't reach it.
          if (!this.webrtcSvc.hasPeer(fromSocketId)) this.webrtcSvc.createPeer(fromSocketId, true);
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
      this.socketSvc.meetingScreenShare$.subscribe(({ socketId, sharing }) => {
        if (sharing) this.screenSharingPeers.add(socketId); else this.screenSharingPeers.delete(socketId);
      })
    );
    this.subs.add(
      this.socketSvc.meetingHandRaise$.subscribe(({ socketId, raised }) => {
        if (raised) this.raisedHandPeers.add(socketId); else this.raisedHandPeers.delete(socketId);
      })
    );
    this.subs.add(
      this.socketSvc.meetingMobileDevice$.subscribe(({ socketId, mobile }) => {
        if (mobile) this.mobileDevicePeers.add(socketId); else this.mobileDevicePeers.delete(socketId);
      })
    );
    this.subs.add(
      this.socketSvc.meetingChatMessage$.subscribe((entry) => {
        this.chatMessages.push(entry);
      })
    );
    this.subs.add(
      this.socketSvc.meetingKicked$.subscribe(() => {
        this.leave();
        this.kicked$.next();
      })
    );
    this.subs.add(
      this.socketSvc.meetingEnded$.subscribe(() => {
        this.leave();
        this.ended$.next();
      })
    );
    // Browser's native "Stop sharing" bar, not our own toggle button — sync
    // state and let the other side know, mirroring CallSessionService's
    // equivalent 1:1 handling of the same webrtcSvc event.
    this.subs.add(
      this.webrtcSvc.screenShareEnded$.subscribe(() => {
        this.isScreenSharing = false;
        if (this.meeting) this.socketSvc.sendMeetingScreenShare(this.meeting.id, false);
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
    // reserveVideoSlot: true — lets toggleScreenShare() below be a plain
    // replaceTrack() swap for every meeting peer, same as the 1:1 call path.
    this.webrtcSvc.createPeer(socketId, true);
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

  async toggleScreenShare() {
    if (!this.meeting) return;
    if (this.isScreenSharing) {
      await this.webrtcSvc.stopScreenShare();
      this.isScreenSharing = false;
    } else {
      try {
        await this.webrtcSvc.startScreenShare();
      } catch {
        return; // picker dismissed/denied
      }
      if (!this.meeting) {
        await this.webrtcSvc.stopScreenShare();
        return;
      }
      this.isScreenSharing = true;
    }
    this.socketSvc.sendMeetingScreenShare(this.meeting.id, this.isScreenSharing);
  }

  toggleHandRaise() {
    if (!this.meeting) return;
    this.handRaised = !this.handRaised;
    this.socketSvc.sendMeetingHandRaise(this.meeting.id, this.handRaised);
  }

  sendChatMessage(message: string) {
    if (!this.meeting || !message.trim()) return;
    this.socketSvc.sendMeetingChatMessage(this.meeting.id, message.trim());
  }
}
