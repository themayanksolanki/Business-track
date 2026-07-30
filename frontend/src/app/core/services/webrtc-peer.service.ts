import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

// Voice doesn't need stereo — forcing mono halves the bandwidth a call's
// audio track needs with no perceptible quality loss for a 1:1 voice call.
export const CALL_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

// Reasonable defaults for a 1:1 call's camera feed — ideal (not exact)
// constraints so it still gracefully degrades on modest hardware/cameras
// instead of failing outright, while capping how demanding a high-res
// webcam can get (bandwidth + CPU) with no explicit ceiling otherwise.
export const CAMERA_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
};

// Screen content is mostly static (text, UI) — a much lower frame rate is
// imperceptible for that and saves significant bandwidth, while a higher
// resolution ceiling keeps text legible. Paired with contentHint and
// degradationPreference below, both set where the track is captured/attached.
export const SCREEN_SHARE_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 10, max: 15 },
};

@Injectable({ providedIn: 'root' })
export class WebrtcPeerService {
  private peers = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private remoteDescSet = new Set<string>();
  private localStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  // One video sender per peer, reserved up front (see createPeer) — lets
  // startScreenShare/stopScreenShare below always be a plain replaceTrack()
  // swap, even for an audio-only call that never had a real video track.
  private videoSenders = new Map<string, RTCRtpSender>();
  private screenStream: MediaStream | null = null;

  readonly remoteStreamAdded$ = new Subject<{ peerId: string; stream: MediaStream }>();
  readonly localStreamReady$  = new Subject<MediaStream>();
  readonly iceCandidateReady$ = new Subject<{ peerId: string; candidate: RTCIceCandidateInit }>();
  // Fires when a share ends via the browser's own "Stop sharing" bar rather
  // than the in-app toggle — consumers (CallSessionService) sync their
  // isScreenSharing flag and re-signal the other side off the back of this.
  readonly screenShareEnded$ = new Subject<void>();

  setIceServers(servers: RTCIceServer[]) {
    this.iceServers = servers;
  }

  getCurrentLocalStream(): MediaStream | null {
    return this.localStream;
  }

  async getLocalStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    this.localStreamReady$.next(this.localStream);
    return this.localStream;
  }

  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  // reserveVideoSlot: screen-share support needs a video sender to exist
  // even on an audio-only call, added up front so sharing later is a plain
  // replaceTrack() swap rather than a mid-call renegotiation. Both
  // CallSessionService (1:1) and MeetingSessionService (Meet Hub group
  // meetings) pass true for every real peer; defaults to off only so any
  // other/future caller that never needs screen share doesn't get a
  // reserved-but-unused video m-line on an audio-only connection.
  createPeer(peerId: string, reserveVideoSlot = false): RTCPeerConnection {
    this.closePeer(peerId);

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    if (reserveVideoSlot) {
      const existingVideoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
      const videoSender = existingVideoSender
        ?? pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      this.videoSenders.set(peerId, videoSender);
      // Only when a real camera track is already attached (a genuine video
      // call) — the reserved-but-empty slot on an audio call has no track
      // yet for this hint to apply to.
      if (existingVideoSender) void this.setDegradationPreference(videoSender, 'maintain-framerate');
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.iceCandidateReady$.next({ peerId, candidate: e.candidate });
    };

    // Builds one canonical MediaStream per peer ourselves rather than
    // trusting e.streams[0] — the reserved video transceiver above (used
    // for audio-only calls) has no stream/msid association the way
    // addTrack(track, localStream) gives the real tracks, so its ontrack
    // fires with an empty e.streams. Relying on e.streams[0] would then
    // depend on event-firing order (audio vs. the empty video slot) to
    // decide whether the video track lands in the same stream as the audio
    // one, or gets silently orphaned in a stream nobody's holding a
    // reference to. Merging every incoming track into our own map entry
    // sidesteps that ordering dependency entirely.
    pc.ontrack = (e) => {
      const stream = this.remoteStreams.get(peerId) ?? new MediaStream();
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      this.remoteStreams.set(peerId, stream);
      this.remoteStreamAdded$.next({ peerId, stream });
    };

    this.peers.set(peerId, pc);
    this.pendingCandidates.set(peerId, []);
    return pc;
  }

  async createOffer(peerId: string): Promise<RTCSessionDescriptionInit> {
    const pc = this.requirePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(peerId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const pc = this.requirePeer(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushPendingCandidates(peerId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async setRemoteAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.requirePeer(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushPendingCandidates(peerId);
  }

  async addIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(peerId);
    if (pc && this.remoteDescSet.has(peerId)) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      const queue = this.pendingCandidates.get(peerId) ?? [];
      queue.push(candidate);
      this.pendingCandidates.set(peerId, queue);
    }
  }

  private async flushPendingCandidates(peerId: string): Promise<void> {
    this.remoteDescSet.add(peerId);
    const pc = this.peers.get(peerId);
    const queue = this.pendingCandidates.get(peerId) ?? [];
    for (const c of queue) {
      await pc?.addIceCandidate(new RTCIceCandidate(c));
    }
    this.pendingCandidates.set(peerId, []);
  }

  setMuted(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  setCameraOff(off: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !off));
  }

  get isScreenSharing(): boolean {
    return !!this.screenStream;
  }

  getCurrentScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  async startScreenShare(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: SCREEN_SHARE_VIDEO_CONSTRAINTS,
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    // Hints the encoder to favor sharpness over motion smoothness — matters
    // far more for a shared doc/code window than the frame-rate constraint
    // above alone.
    track.contentHint = 'detail';
    this.screenStream = stream;
    const senders = [...this.videoSenders.values()];
    // Swallow per-sender failures (e.g. the call ended and its peer
    // connection closed while the screen/window picker was open) rather
    // than letting Promise.all reject the whole call — a stale sender
    // failing to swap shouldn't stop the others or blow up the caller.
    await Promise.all(senders.map((s) => s.replaceTrack(track).catch(() => {})));
    await Promise.all(senders.map((s) => this.setDegradationPreference(s, 'maintain-resolution')));
    // Fires when the user stops sharing via the browser's own UI (the
    // "Stop sharing" bar / X on the shared-tab indicator) instead of our
    // in-app button.
    track.onended = () => {
      void this.stopScreenShare().then(() => this.screenShareEnded$.next());
    };
    return stream;
  }

  async stopScreenShare(): Promise<void> {
    const cameraTrack = this.localStream?.getVideoTracks()[0] ?? null;
    const senders = [...this.videoSenders.values()];
    await Promise.all(senders.map((s) => s.replaceTrack(cameraTrack).catch(() => {})));
    if (cameraTrack) {
      await Promise.all(senders.map((s) => this.setDegradationPreference(s, 'maintain-framerate')));
    }
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  // Lets an audio-only call turn its camera on/off mid-call, using the same
  // reserved video sender screen share uses. The acquired track is merged
  // straight into localStream (rather than tracked separately) so it
  // automatically becomes what stopScreenShare()'s existing revert-to-camera
  // logic falls back to, and so ending the call (which already stops every
  // track in localStream) releases the camera with no extra cleanup here.
  async enableVideo(): Promise<void> {
    if ((this.localStream?.getVideoTracks().length ?? 0) > 0) return; // already on
    const stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA_VIDEO_CONSTRAINTS });
    const track = stream.getVideoTracks()[0];
    this.localStream?.addTrack(track);
    // If a screen share is currently live, leave the sender alone — the
    // camera track is now in place as the fallback for whenever that share
    // stops, same as a video call's own camera already behaves.
    if (!this.screenStream) {
      const senders = [...this.videoSenders.values()];
      await Promise.all(senders.map((s) => s.replaceTrack(track).catch(() => {})));
      await Promise.all(senders.map((s) => this.setDegradationPreference(s, 'maintain-framerate')));
    }
  }

  disableVideo(): void {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return;
    track.stop();
    this.localStream?.removeTrack(track);
    if (!this.screenStream) {
      void Promise.all([...this.videoSenders.values()].map((s) => s.replaceTrack(null).catch(() => {})));
    }
  }

  closePeer(peerId: string) {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    this.remoteStreams.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.remoteDescSet.delete(peerId);
    this.videoSenders.delete(peerId);
    if (this.videoSenders.size === 0 && this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
  }

  stopLocalStream() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  cleanupAll() {
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.remoteStreams.clear();
    this.pendingCandidates.clear();
    this.remoteDescSet.clear();
    this.videoSenders.clear();
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.stopLocalStream();
  }

  // Tells the encoder what to sacrifice first under bandwidth pressure —
  // camera video reads worse choppy than slightly soft, so it keeps frame
  // rate over resolution; a shared screen is the opposite (a blurry doc/code
  // window is far more annoying than a slightly less smooth cursor), so it
  // keeps resolution over frame rate. Not all browsers/senders support this,
  // so failures are swallowed — it's a quality hint, not a correctness need.
  private async setDegradationPreference(sender: RTCRtpSender, pref: RTCDegradationPreference) {
    try {
      const params = sender.getParameters();
      params.degradationPreference = pref;
      await sender.setParameters(params);
    } catch { /* unsupported — the call still works, just without this hint */ }
  }

  private requirePeer(peerId: string): RTCPeerConnection {
    const pc = this.peers.get(peerId);
    if (!pc) throw new Error(`WebrtcPeerService: no peer connection for "${peerId}"`);
    return pc;
  }
}
