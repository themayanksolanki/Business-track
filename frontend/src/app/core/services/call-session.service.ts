import { Injectable } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { SocketService, IncomingCall } from './socket.service';
import { WebrtcPeerService, CALL_AUDIO_CONSTRAINTS, CAMERA_VIDEO_CONSTRAINTS } from './webrtc-peer.service';
import { AuthService } from './auth.service';
import { ChatService } from './chat.service';
import { User } from '../../models/user.model';

export type CallState = 'idle' | 'calling' | 'incoming' | 'in-call';

// Owns the 1:1 audio/video call session app-wide — previously all of this
// lived inside ChatComponent, which meant navigating away from /chat (or an
// incoming call arriving on any other page) ended/missed the call outright.
// As a root singleton this survives route changes, so the floating call
// widget (shared/call-widget) can keep the call alive and visible from any
// page; ChatComponent only triggers startCall()/keeps chat-page state.
@Injectable({ providedIn: 'root' })
export class CallSessionService {
  private readonly PEER_ID = 'chat';

  callState: CallState = 'idle';
  callType: 'audio' | 'video' = 'video';
  callWith: string | null = null;
  callWithUser: User | null = null;
  incomingCall: IncomingCall | null = null;

  isMuted     = false;
  isCamOff    = false;
  remoteMuted = false;
  remoteCamOff = false;
  isScreenSharing = false;
  remoteScreenSharing = false;
  // Separate from isCamOff/remoteCamOff on purpose: those two default to
  // false meaning "camera assumed on" (the right starting assumption for a
  // video call), whereas an audio call needs to default to "no camera yet" —
  // reusing the same fields would conflate two different default meanings.
  audioCallVideoOn = false;
  remoteVideoOnInAudioCall = false;
  minimized   = false;
  callNotice  = '';

  callElapsed = 0;
  remoteStream: MediaStream | null = null;

  // Fires whenever a call fully ends/is cleaned up — the widget listens to
  // reset its own view-local state (fullscreen, tap-to-swap tile order).
  readonly ended$ = new Subject<void>();

  private callId: string | null = null;
  private pendingOffer: { from: string; offer: RTCSessionDescriptionInit; callId: string } | null = null;
  private callTimeout: any;
  private callTimerInterval: any = null;
  private callStartTime: number | null = null;

  private readonly ringAudio     = Object.assign(new Audio('/assets/ring.mp3'),     { loop: true, preload: 'auto' });
  private readonly ringtoneAudio = Object.assign(new Audio('/assets/ringtone.mp3'), { loop: true, preload: 'auto' });
  private audioUnlocked = false;

  private subs = new Subscription();

  constructor(
    private auth: AuthService,
    private chatSvc: ChatService,
    private socketSvc: SocketService,
    private webrtcSvc: WebrtcPeerService,
  ) {
    this.chatSvc.getIceServers().subscribe({
      next: ({ iceServers }) => this.webrtcSvc.setIceServers(iceServers),
    });
    this.subscribeToSocket();
    // Ringtone/ring playback needs a user gesture to unlock autoplay in most
    // browsers — any click anywhere in the app satisfies that, not just one
    // on the chat page.
    document.addEventListener('click', this.unlockAudio);
  }

  private unlockAudio = () => {
    if (this.audioUnlocked) return;
    Promise.all(
      [this.ringAudio, this.ringtoneAudio].map((a) => a.play().then(() => { a.pause(); a.currentTime = 0; }))
    )
      .then(() => { this.audioUnlocked = true; })
      .catch(() => {});
  };

  private subscribeToSocket() {
    this.subs.add(this.socketSvc.callSession$.subscribe(({ callId }) => { this.callId = callId; }));
    this.subs.add(this.socketSvc.callIncoming$.subscribe((d) => this.onCallIncoming(d)));
    this.subs.add(this.socketSvc.callAccepted$.subscribe(() => this.onCallAccepted()));
    this.subs.add(this.socketSvc.callRejected$.subscribe(() => this.onCallRejected()));
    this.subs.add(this.socketSvc.callEnded$.subscribe(() => this.onCallEnded()));
    this.subs.add(this.socketSvc.callOffline$.subscribe(() => this.onCallOffline()));
    this.subs.add(this.socketSvc.callOffer$.subscribe((d) => this.onCallOffer(d)));
    this.subs.add(this.socketSvc.callAnswer$.subscribe((d) => this.onCallAnswer(d)));
    this.subs.add(this.socketSvc.iceCandidate$.subscribe((d) => this.onIceCandidate(d)));
    this.subs.add(this.socketSvc.remoteMuted$.subscribe((m) => { this.remoteMuted = m; }));
    // Reuses the same call:video wire event for both meanings: on a video
    // call, "off" is the peer's camera mute state; on an audio call, there
    // was never a camera track to mute, so the identical signal instead
    // means "the peer just turned their camera on/off from nothing."
    this.subs.add(
      this.socketSvc.remoteCamOff$.subscribe((off) => {
        if (this.callType === 'audio') this.remoteVideoOnInAudioCall = !off;
        else this.remoteCamOff = off;
      })
    );
    this.subs.add(this.socketSvc.remoteScreenSharing$.subscribe((sharing) => { this.remoteScreenSharing = sharing; }));

    // Covers the other side stopping their share via the browser's own
    // "Stop sharing" bar rather than our in-app toggle.
    this.subs.add(
      this.webrtcSvc.screenShareEnded$.subscribe(() => {
        this.isScreenSharing = false;
        if (this.callId) this.socketSvc.sendScreenShareState(this.callId, false);
      })
    );

    this.subs.add(
      this.webrtcSvc.iceCandidateReady$.subscribe(({ peerId, candidate }) => {
        if (peerId === this.PEER_ID && this.callId) {
          this.socketSvc.sendIceCandidate(this.callId, candidate);
        }
      })
    );
    this.subs.add(
      this.webrtcSvc.remoteStreamAdded$.subscribe(({ peerId, stream }) => {
        if (peerId !== this.PEER_ID) return;
        this.remoteStream = stream;
      })
    );
  }

  // ── Initiate call ─────────────────────────────────────────────
  async startCall(user: User, type: 'audio' | 'video') {
    if (this.callState !== 'idle') return;
    this.callType     = type;
    this.callWith     = String(user.id);
    this.callWithUser = user;
    this.callState    = 'calling';

    try {
      await this.webrtcSvc.getLocalStream({
        audio: CALL_AUDIO_CONSTRAINTS,
        video: type === 'video' ? CAMERA_VIDEO_CONSTRAINTS : false,
      });
      this.webrtcSvc.createPeer(this.PEER_ID, true);
      this.socketSvc.requestCall(this.callWith, this.auth.getUser()?.username ?? 'Someone', type);
      void this.ringAudio.play().catch(() => {});
      this.callTimeout = setTimeout(() => {
        if (this.callState === 'calling') this.cancelCall();
      }, 30000);
    } catch {
      this.cleanupCall();
      this.showCallNotice('Could not access your camera or microphone.');
    }
  }

  cancelCall() {
    if (this.callId) this.socketSvc.endCall(this.callId);
    this.cleanupCall();
  }

  // ── Incoming call ─────────────────────────────────────────────
  private onCallIncoming(data: IncomingCall) {
    if (this.callState !== 'idle') {
      this.socketSvc.rejectCall(data.callId);
      return;
    }
    this.incomingCall = data;
    this.callState = 'incoming';
    void this.ringtoneAudio.play().catch(() => {});
  }

  async acceptCall() {
    if (!this.incomingCall) return;
    this.callId       = this.incomingCall.callId;
    this.callWith     = this.incomingCall.from;
    this.callType     = this.incomingCall.callType;
    this.callWithUser = this.chatSvc.contacts().find((c) => String(c.user.id) === this.callWith)?.user ?? null;
    this.incomingCall = null;
    this.callState    = 'in-call';
    this.stopAllAudio();
    this.startCallTimer();

    try {
      await this.webrtcSvc.getLocalStream({
        audio: CALL_AUDIO_CONSTRAINTS,
        video: this.callType === 'video' ? CAMERA_VIDEO_CONSTRAINTS : false,
      });
      this.webrtcSvc.createPeer(this.PEER_ID, true);
      this.socketSvc.acceptCall(this.callId);

      if (this.pendingOffer) {
        const offer = this.pendingOffer;
        this.pendingOffer = null;
        await this.answerOffer(offer);
      }
    } catch {
      const cid = this.callId;
      if (cid) this.socketSvc.rejectCall(cid);
      this.cleanupCall();
      this.showCallNotice('Could not access your camera or microphone.');
    }
  }

  rejectCall() {
    if (this.incomingCall) this.socketSvc.rejectCall(this.incomingCall.callId);
    this.incomingCall = null;
    this.callState = 'idle';
    this.stopAllAudio();
  }

  endCall() {
    if (this.callId) this.socketSvc.endCall(this.callId);
    this.cleanupCall();
  }

  // ── WebRTC signaling ──────────────────────────────────────────
  private async onCallAccepted() {
    clearTimeout(this.callTimeout);
    this.callState = 'in-call';
    this.stopAllAudio();
    this.startCallTimer();
    if (!this.webrtcSvc.hasPeer(this.PEER_ID) || !this.callId) return;
    const offer = await this.webrtcSvc.createOffer(this.PEER_ID);
    this.socketSvc.sendOffer(this.callId, offer);
  }

  private onCallRejected() {
    const name = this.callWithUser?.username ?? 'User';
    this.cleanupCall();
    this.showCallNotice(`${name} declined the call.`);
  }

  private onCallEnded() {
    this.cleanupCall();
  }

  private onCallOffline() {
    const name = this.callWithUser?.username ?? 'User';
    this.cleanupCall();
    this.showCallNotice(`${name} is not available right now.`);
  }

  private async onCallOffer(data: { from: string; offer: RTCSessionDescriptionInit; callId: string }) {
    if (!this.webrtcSvc.hasPeer(this.PEER_ID)) {
      this.pendingOffer = data;
      return;
    }
    await this.answerOffer(data);
  }

  private async answerOffer(data: { from: string; offer: RTCSessionDescriptionInit; callId: string }) {
    if (!this.webrtcSvc.hasPeer(this.PEER_ID)) {
      this.pendingOffer = data;
      return;
    }
    const answer = await this.webrtcSvc.createAnswer(this.PEER_ID, data.offer);
    this.socketSvc.sendAnswer(data.callId, answer);
  }

  private async onCallAnswer(data: { answer: RTCSessionDescriptionInit }) {
    if (!this.webrtcSvc.hasPeer(this.PEER_ID)) return;
    await this.webrtcSvc.setRemoteAnswer(this.PEER_ID, data.answer);
  }

  private async onIceCandidate(data: { candidate: RTCIceCandidateInit }) {
    await this.webrtcSvc.addIceCandidate(this.PEER_ID, data.candidate);
  }

  // ── Call timer ────────────────────────────────────────────────
  private startCallTimer() {
    this.stopCallTimer();
    this.callElapsed   = 0;
    this.callStartTime = Date.now();
    this.callTimerInterval = setInterval(() => {
      this.callElapsed = Math.floor((Date.now() - this.callStartTime!) / 1000);
    }, 1000);
  }

  private stopCallTimer() {
    clearInterval(this.callTimerInterval);
    this.callTimerInterval = null;
    this.callElapsed   = 0;
    this.callStartTime = null;
  }

  formatCallTimer(): string {
    const m   = Math.floor(this.callElapsed / 60);
    const sec = this.callElapsed % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  private stopAllAudio() {
    [this.ringAudio, this.ringtoneAudio].forEach((a) => { a.pause(); a.currentTime = 0; });
  }

  private showCallNotice(message: string) {
    this.callNotice = message;
    setTimeout(() => (this.callNotice = ''), 3500);
  }

  private cleanupCall() {
    clearTimeout(this.callTimeout);
    this.stopCallTimer();
    this.stopAllAudio();
    this.webrtcSvc.closePeer(this.PEER_ID);
    this.webrtcSvc.stopLocalStream();
    this.remoteStream   = null;
    this.pendingOffer    = null;
    this.callState       = 'idle';
    this.callId          = null;
    this.callWith        = null;
    this.callWithUser    = null;
    this.incomingCall    = null;
    this.isMuted         = false;
    this.isCamOff        = false;
    this.remoteMuted     = false;
    this.remoteCamOff    = false;
    this.isScreenSharing = false;
    this.remoteScreenSharing = false;
    this.audioCallVideoOn = false;
    this.remoteVideoOnInAudioCall = false;
    this.minimized       = false;
    this.ended$.next();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.webrtcSvc.setMuted(this.isMuted);
    if (this.callId) this.socketSvc.sendMuteState(this.callId, this.isMuted);
  }

  toggleCamera() {
    this.isCamOff = !this.isCamOff;
    this.webrtcSvc.setCameraOff(this.isCamOff);
    if (this.callId) this.socketSvc.sendVideoState(this.callId, this.isCamOff);
  }

  toggleMinimize() {
    this.minimized = !this.minimized;
  }

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      await this.webrtcSvc.stopScreenShare();
      this.isScreenSharing = false;
    } else {
      try {
        await this.webrtcSvc.startScreenShare();
      } catch {
        // Picker dismissed/denied — leave state as-is, no error toast.
        return;
      }
      if (this.callState === 'idle') {
        // The call ended while the screen/window picker was open — don't
        // leave a dangling capture with no call left to send it to.
        await this.webrtcSvc.stopScreenShare();
        return;
      }
      this.isScreenSharing = true;
    }
    if (this.callId) this.socketSvc.sendScreenShareState(this.callId, this.isScreenSharing);
  }

  async toggleAudioCallVideo() {
    if (this.audioCallVideoOn) {
      this.webrtcSvc.disableVideo();
      this.audioCallVideoOn = false;
    } else {
      try {
        await this.webrtcSvc.enableVideo();
      } catch {
        this.showCallNotice('Could not access your camera.');
        return;
      }
      if (this.callState === 'idle') {
        // Call ended while camera permission was pending — don't leave the
        // camera acquired with no call left to send it to.
        this.webrtcSvc.disableVideo();
        return;
      }
      this.audioCallVideoOn = true;
    }
    if (this.callId) this.socketSvc.sendVideoState(this.callId, !this.audioCallVideoOn);
  }
}
