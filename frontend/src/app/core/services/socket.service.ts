import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Message } from '../../models/message.model';

export interface IncomingCall {
  from: string;
  fromName: string;
  callType: 'audio' | 'video';
  callId: string;
}

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket | null = null;

  readonly message$            = new Subject<Message>();
  readonly messageSent$        = new Subject<Message>();
  readonly messageDelivered$   = new Subject<{ by: string }>();
  readonly messageSeen$        = new Subject<{ by: string }>();
  readonly onlineUsers$        = new Subject<string[]>();
  readonly messageEdited$      = new Subject<Message>();
  readonly messageDeleted$     = new Subject<{ messageId: string; forAll: boolean }>();
  readonly messagePinned$      = new Subject<{ messageId: string; pinned: boolean }>();

  readonly callSession$   = new Subject<{ callId: string }>();
  readonly callIncoming$  = new Subject<IncomingCall>();
  readonly callAccepted$  = new Subject<{ callId: string }>();
  readonly callRejected$  = new Subject<{ callId: string }>();
  readonly callEnded$     = new Subject<{ callId: string }>();
  readonly callOffline$   = new Subject<void>();
  readonly callOffer$     = new Subject<{ from: string; offer: RTCSessionDescriptionInit; callId: string }>();
  readonly callAnswer$    = new Subject<{ answer: RTCSessionDescriptionInit; callId: string }>();
  readonly iceCandidate$  = new Subject<{ candidate: RTCIceCandidateInit; callId: string }>();
  readonly remoteMuted$   = new Subject<boolean>();
  readonly callLogged$    = new Subject<Message>();

  connect(token: string) {
    if (this.socket?.connected) return;
    this.socket = io(environment.socketUrl, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('message:receive',   (m: Message)          => this.message$.next(m));
    this.socket.on('message:sent',      (m: Message)          => this.messageSent$.next(m));
    this.socket.on('message:delivered', (d: { by: string })   => this.messageDelivered$.next(d));
    this.socket.on('message:seen',      (d: { by: string })   => this.messageSeen$.next(d));
    this.socket.on('users:online',      (u: string[])         => this.onlineUsers$.next(u));
    this.socket.on('message:edited',    (m: Message)                                    => this.messageEdited$.next(m));
    this.socket.on('message:deleted',   (d: { messageId: string; forAll: boolean })      => this.messageDeleted$.next(d));
    this.socket.on('message:pinned',    (d: { messageId: string; pinned: boolean })      => this.messagePinned$.next(d));

    this.socket.on('call:session',      (d: { callId: string })                                     => this.callSession$.next(d));
    this.socket.on('call:incoming',     (d: IncomingCall)                                           => this.callIncoming$.next(d));
    this.socket.on('call:accepted',     (d: { callId: string })                                     => this.callAccepted$.next(d));
    this.socket.on('call:rejected',     (d: { callId: string })                                     => this.callRejected$.next(d));
    this.socket.on('call:ended',        (d: { callId: string })                                     => this.callEnded$.next(d));
    this.socket.on('call:user-offline', ()                                                          => this.callOffline$.next());
    this.socket.on('call:offer',        (d: { from: string; offer: RTCSessionDescriptionInit; callId: string }) => this.callOffer$.next(d));
    this.socket.on('call:answer',       (d: { answer: RTCSessionDescriptionInit; callId: string })  => this.callAnswer$.next(d));
    this.socket.on('call:ice-candidate',(d: { candidate: RTCIceCandidateInit; callId: string })     => this.iceCandidate$.next(d));
    this.socket.on('call:mute',         (d: { muted: boolean })                                     => this.remoteMuted$.next(d.muted));
    this.socket.on('call:logged',       (m: Message)                                                 => this.callLogged$.next(m));
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  sendMessage(to: string, content: string, type: 'text' | 'image' = 'text', fileUrl?: string, replyTo?: string) {
    this.socket?.emit('message:send', { to, content, type, fileUrl, replyTo });
  }

  editMessage(messageId: string, content: string) {
    this.socket?.emit('message:edit', { messageId, content });
  }

  deleteMessage(messageId: string, forAll: boolean) {
    this.socket?.emit('message:delete', { messageId, forAll });
  }

  pinMessage(messageId: string, pinned: boolean) {
    this.socket?.emit('message:pin', { messageId, pinned });
  }

  requestCall(to: string, fromName: string, callType: 'audio' | 'video') {
    this.socket?.emit('call:request', { to, fromName, callType });
  }

  acceptCall(callId: string)  { this.socket?.emit('call:accepted', { callId }); }
  rejectCall(callId: string)  { this.socket?.emit('call:rejected', { callId }); }
  endCall(callId: string)     { this.socket?.emit('call:ended',    { callId }); }

  sendOffer(callId: string, offer: RTCSessionDescriptionInit) {
    this.socket?.emit('call:offer', { callId, offer });
  }
  sendAnswer(callId: string, answer: RTCSessionDescriptionInit) {
    this.socket?.emit('call:answer', { callId, answer });
  }
  sendIceCandidate(callId: string, candidate: RTCIceCandidateInit) {
    this.socket?.emit('call:ice-candidate', { callId, candidate });
  }

  sendMuteState(callId: string, muted: boolean) {
    this.socket?.emit('call:mute', { callId, muted });
  }

  markSeen(from: string) {
    this.socket?.emit('message:seen', { from });
  }
}
