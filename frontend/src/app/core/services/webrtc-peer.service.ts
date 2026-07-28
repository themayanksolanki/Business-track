import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WebrtcPeerService {
  private peers = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private remoteDescSet = new Set<string>();
  private localStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  readonly remoteStreamAdded$ = new Subject<{ peerId: string; stream: MediaStream }>();
  readonly localStreamReady$  = new Subject<MediaStream>();
  readonly iceCandidateReady$ = new Subject<{ peerId: string; candidate: RTCIceCandidateInit }>();

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

  createPeer(peerId: string): RTCPeerConnection {
    this.closePeer(peerId);

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate) this.iceCandidateReady$.next({ peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      let stream = e.streams[0];
      if (!stream) {
        stream = this.remoteStreams.get(peerId) ?? new MediaStream();
        stream.addTrack(e.track);
      }
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

  closePeer(peerId: string) {
    this.peers.get(peerId)?.close();
    this.peers.delete(peerId);
    this.remoteStreams.delete(peerId);
    this.pendingCandidates.delete(peerId);
    this.remoteDescSet.delete(peerId);
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
    this.stopLocalStream();
  }

  private requirePeer(peerId: string): RTCPeerConnection {
    const pc = this.peers.get(peerId);
    if (!pc) throw new Error(`WebrtcPeerService: no peer connection for "${peerId}"`);
    return pc;
  }
}
