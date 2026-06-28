import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Message } from '../../models/message.model';

export interface IncomingCall {
  from: string;
  fromName: string;
  callType: 'audio' | 'video';
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;

  readonly message$       = new Subject<Message>();
  readonly messageSent$   = new Subject<Message>();
  readonly onlineUsers$   = new Subject<string[]>();

  readonly callIncoming$  = new Subject<IncomingCall>();
  readonly callAccepted$  = new Subject<void>();
  readonly callRejected$  = new Subject<void>();
  readonly callEnded$     = new Subject<void>();
  readonly callOffline$   = new Subject<void>();
  readonly callOffer$     = new Subject<{ from: string; offer: RTCSessionDescriptionInit }>();
  readonly callAnswer$    = new Subject<{ answer: RTCSessionDescriptionInit }>();
  readonly iceCandidate$  = new Subject<{ candidate: RTCIceCandidateInit }>();
  readonly remoteMuted$   = new Subject<boolean>();

  connect(token: string) {
    if (this.socket?.connected) return;
    this.socket = io(environment.socketUrl, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('message:receive', (m: Message) => this.message$.next(m));
    this.socket.on('message:sent',    (m: Message) => this.messageSent$.next(m));
    this.socket.on('users:online',    (u: string[]) => this.onlineUsers$.next(u));

    this.socket.on('call:incoming',     (d: IncomingCall) => this.callIncoming$.next(d));
    this.socket.on('call:accepted',     ()  => this.callAccepted$.next());
    this.socket.on('call:rejected',     ()  => this.callRejected$.next());
    this.socket.on('call:ended',        ()  => this.callEnded$.next());
    this.socket.on('call:user-offline', ()  => this.callOffline$.next());
    this.socket.on('call:offer',        (d) => this.callOffer$.next(d));
    this.socket.on('call:answer',       (d) => this.callAnswer$.next(d));
    this.socket.on('call:ice-candidate',(d) => this.iceCandidate$.next(d));
    this.socket.on('call:mute',         (d: { muted: boolean }) => this.remoteMuted$.next(d.muted));
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  sendMessage(to: string, content: string, type: 'text' | 'image' = 'text', fileUrl?: string) {
    this.socket?.emit('message:send', { to, content, type, fileUrl });
  }

  requestCall(to: string, fromName: string, callType: 'audio' | 'video') {
    this.socket?.emit('call:request', { to, fromName, callType });
  }

  acceptCall(to: string)  { this.socket?.emit('call:accepted',     { to }); }
  rejectCall(to: string)  { this.socket?.emit('call:rejected',     { to }); }
  endCall(to: string)     { this.socket?.emit('call:ended',        { to }); }

  sendOffer(to: string, offer: RTCSessionDescriptionInit) {
    this.socket?.emit('call:offer', { to, offer });
  }
  sendAnswer(to: string, answer: RTCSessionDescriptionInit) {
    this.socket?.emit('call:answer', { to, answer });
  }
  sendIceCandidate(to: string, candidate: RTCIceCandidateInit) {
    this.socket?.emit('call:ice-candidate', { to, candidate });
  }

  sendMuteState(to: string, muted: boolean) {
    this.socket?.emit('call:mute', { to, muted });
  }
}
