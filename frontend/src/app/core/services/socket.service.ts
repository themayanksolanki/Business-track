import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../../environments/environment';
import { Message, MessageReaction } from '../../models/message.model';
import { AppNotification } from '../../models/notification.model';
import { GroupMessage } from '../../models/group.model';

export interface IncomingCall {
  from: string;
  fromName: string;
  callType: 'audio' | 'video';
  callId: string;
}

// A meeting-room peer's identity — 'id' is a real User.id for 'user', a
// MeetingGuest.id for 'guest' (an unrelated id space; never treat a guest's
// `id` as a User.id). displayName is only ever set for a guest — a real
// user's name is resolved via Meeting.participants instead.
export interface MeetingPeerIdentity {
  kind: 'user' | 'guest';
  id: number;
  displayName?: string;
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
  readonly messageReaction$    = new Subject<{ messageId: number; reactions: MessageReaction[] }>();
  readonly typing$             = new Subject<{ from: string; isTyping: boolean }>();

  readonly groupMessage$         = new Subject<GroupMessage>();
  readonly groupMessageSent$     = new Subject<GroupMessage>();
  readonly groupMessageEdited$   = new Subject<GroupMessage>();
  readonly groupMessageDeleted$  = new Subject<{ messageId: string; forAll: boolean }>();
  readonly groupMessagePinned$   = new Subject<{ messageId: string; pinned: boolean }>();
  readonly groupMessageSeen$     = new Subject<{ groupId: number; by: string }>();
  readonly groupTyping$          = new Subject<{ groupId: number; from: string; isTyping: boolean }>();
  readonly groupMessageError$    = new Subject<string>();

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
  readonly remoteCamOff$  = new Subject<boolean>();
  readonly remoteScreenSharing$ = new Subject<boolean>();
  // See device.util.ts's isMobileDevice() — sent once at call start/accept,
  // not toggled like the above.
  readonly remoteMobileDevice$ = new Subject<boolean>();
  readonly callLogged$    = new Subject<Message>();

  readonly meetingJoined$            = new Subject<{ members: ({ socketId: string } & MeetingPeerIdentity)[] }>();
  readonly meetingJoinError$         = new Subject<{ message: string }>();
  readonly meetingRoomFull$          = new Subject<void>();
  readonly meetingParticipantJoined$ = new Subject<{ socketId: string } & MeetingPeerIdentity>();
  readonly meetingParticipantLeft$   = new Subject<{ socketId: string }>();
  readonly meetingSignal$            = new Subject<{ fromSocketId: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }>();
  readonly meetingMute$              = new Subject<{ socketId: string; muted: boolean }>();
  readonly meetingVideoToggle$       = new Subject<{ socketId: string; off: boolean }>();
  readonly meetingScreenShare$       = new Subject<{ socketId: string; sharing: boolean }>();
  readonly meetingHandRaise$         = new Subject<{ socketId: string; raised: boolean }>();
  readonly meetingMobileDevice$      = new Subject<{ socketId: string; mobile: boolean }>();
  readonly meetingChatMessage$       = new Subject<{ socketId: string; userId: number; message: string; at: string }>();
  readonly meetingKicked$            = new Subject<void>();
  // Host asked THIS client specifically to mute itself (soft mute — no lock,
  // can unmute again after) — see socket.ts's meeting:mute-participant.
  readonly meetingForceMute$         = new Subject<void>();
  readonly meetingEnded$             = new Subject<void>();

  readonly notification$ = new Subject<AppNotification>();
  // Fires on every reconnect (not the first connect) so listeners can re-sync
  // state that may have changed while the socket was down — mirrors the
  // "deliver missed messages/notifications" pattern the server already does
  // on a fresh connection, but reconnects don't re-run that server-side path
  // for anything already delivered before the drop, so this exists to let the
  // client re-fetch from its own REST endpoints instead.
  readonly reconnected$ = new Subject<void>();

  connect(token: string) {
    if (this.socket?.connected) return;
    this.socket = io(environment.socketUrl, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.io.on('reconnect', () => this.reconnected$.next());

    this.socket.on('notification:new',  (n: AppNotification)  => this.notification$.next(n));
    this.socket.on('message:receive',   (m: Message)          => this.message$.next(m));
    this.socket.on('message:sent',      (m: Message)          => this.messageSent$.next(m));
    this.socket.on('message:delivered', (d: { by: string })   => this.messageDelivered$.next(d));
    this.socket.on('message:seen',      (d: { by: string })   => this.messageSeen$.next(d));
    this.socket.on('users:online',      (u: string[])         => this.onlineUsers$.next(u));
    this.socket.on('message:edited',    (m: Message)                                    => this.messageEdited$.next(m));
    this.socket.on('message:deleted',   (d: { messageId: string; forAll: boolean })      => this.messageDeleted$.next(d));
    this.socket.on('message:pinned',    (d: { messageId: string; pinned: boolean })      => this.messagePinned$.next(d));
    this.socket.on('message:reaction',  (d: { messageId: number; reactions: MessageReaction[] }) => this.messageReaction$.next(d));
    this.socket.on('typing:update',     (d: { from: string; isTyping: boolean })          => this.typing$.next(d));

    this.socket.on('group:message:receive', (m: GroupMessage)                                   => this.groupMessage$.next(m));
    this.socket.on('group:message:sent',    (m: GroupMessage)                                   => this.groupMessageSent$.next(m));
    this.socket.on('group:message:edited',  (m: GroupMessage)                                   => this.groupMessageEdited$.next(m));
    this.socket.on('group:message:deleted', (d: { messageId: string; forAll: boolean })         => this.groupMessageDeleted$.next(d));
    this.socket.on('group:message:pinned',  (d: { messageId: string; pinned: boolean })         => this.groupMessagePinned$.next(d));
    this.socket.on('group:message:seen',    (d: { groupId: number; by: string })                => this.groupMessageSeen$.next(d));
    this.socket.on('group:typing:update',   (d: { groupId: number; from: string; isTyping: boolean }) => this.groupTyping$.next(d));
    this.socket.on('group:message:error',   (msg: string)                                       => this.groupMessageError$.next(msg));

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
    this.socket.on('call:video',        (d: { off: boolean })                                       => this.remoteCamOff$.next(d.off));
    this.socket.on('call:screen-share', (d: { sharing: boolean })                                   => this.remoteScreenSharing$.next(d.sharing));
    this.socket.on('call:mobile-device',(d: { mobile: boolean })                                     => this.remoteMobileDevice$.next(d.mobile));
    this.socket.on('call:logged',       (m: Message)                                                 => this.callLogged$.next(m));

    this.socket.on('meeting:joined',              (d: { members: ({ socketId: string } & MeetingPeerIdentity)[] })               => this.meetingJoined$.next(d));
    this.socket.on('meeting:join-error',          (d: { message: string })                                                       => this.meetingJoinError$.next(d));
    this.socket.on('meeting:room-full',           ()                                                                              => this.meetingRoomFull$.next());
    this.socket.on('meeting:participant-joined',  (d: { socketId: string } & MeetingPeerIdentity)                                => this.meetingParticipantJoined$.next(d));
    this.socket.on('meeting:participant-left',    (d: { socketId: string })                                                      => this.meetingParticipantLeft$.next(d));
    this.socket.on('meeting:signal',              (d: { fromSocketId: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => this.meetingSignal$.next(d));
    this.socket.on('meeting:mute',                (d: { socketId: string; muted: boolean })                                      => this.meetingMute$.next(d));
    this.socket.on('meeting:video-toggle',        (d: { socketId: string; off: boolean })                                        => this.meetingVideoToggle$.next(d));
    this.socket.on('meeting:screen-share',        (d: { socketId: string; sharing: boolean })                                    => this.meetingScreenShare$.next(d));
    this.socket.on('meeting:hand-raise',          (d: { socketId: string; raised: boolean })                                     => this.meetingHandRaise$.next(d));
    this.socket.on('meeting:mobile-device',       (d: { socketId: string; mobile: boolean })                                     => this.meetingMobileDevice$.next(d));
    this.socket.on('meeting:chat-message',        (d: { socketId: string; userId: number; message: string; at: string })         => this.meetingChatMessage$.next(d));
    this.socket.on('meeting:kicked',              ()                                                                              => this.meetingKicked$.next());
    this.socket.on('meeting:force-mute',          ()                                                                              => this.meetingForceMute$.next());
    this.socket.on('meeting:ended',               ()                                                                              => this.meetingEnded$.next());
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

  reactToMessage(messageId: string, emoji: string) {
    this.socket?.emit('message:react', { messageId, emoji });
  }

  sendTyping(to: string, isTyping: boolean) {
    this.socket?.emit(isTyping ? 'typing:start' : 'typing:stop', { to });
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

  sendVideoState(callId: string, off: boolean) {
    this.socket?.emit('call:video', { callId, off });
  }

  sendScreenShareState(callId: string, sharing: boolean) {
    this.socket?.emit('call:screen-share', { callId, sharing });
  }

  sendMobileDeviceState(callId: string, mobile: boolean) {
    this.socket?.emit('call:mobile-device', { callId, mobile });
  }

  markSeen(from: string) {
    this.socket?.emit('message:seen', { from });
  }

  sendGroupMessage(groupId: number, content: string, type: 'text' | 'image' = 'text', fileUrl?: string, replyTo?: string) {
    this.socket?.emit('group:message:send', { groupId, content, type, fileUrl, replyTo });
  }

  editGroupMessage(messageId: string, content: string) {
    this.socket?.emit('group:message:edit', { messageId, content });
  }

  deleteGroupMessage(messageId: string, forAll: boolean) {
    this.socket?.emit('group:message:delete', { messageId, forAll });
  }

  pinGroupMessage(messageId: string, pinned: boolean) {
    this.socket?.emit('group:message:pin', { messageId, pinned });
  }

  markGroupSeen(groupId: number) {
    this.socket?.emit('group:message:seen', { groupId });
  }

  sendGroupTyping(groupId: number, isTyping: boolean) {
    this.socket?.emit(isTyping ? 'group:typing:start' : 'group:typing:stop', { groupId });
  }

  joinMeetingRoom(roomToken: string) {
    this.socket?.emit('meeting:join', { roomToken });
  }

  leaveMeetingRoom(meetingId: number) {
    this.socket?.emit('meeting:leave', { meetingId });
  }

  sendMeetingSignal(
    meetingId: number,
    toSocketId: string,
    payload: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
  ) {
    this.socket?.emit('meeting:signal', { meetingId, toSocketId, ...payload });
  }

  sendMeetingMute(meetingId: number, muted: boolean) {
    this.socket?.emit('meeting:mute', { meetingId, muted });
  }

  sendMeetingVideoToggle(meetingId: number, off: boolean) {
    this.socket?.emit('meeting:video-toggle', { meetingId, off });
  }

  sendMeetingScreenShare(meetingId: number, sharing: boolean) {
    this.socket?.emit('meeting:screen-share', { meetingId, sharing });
  }

  sendMeetingHandRaise(meetingId: number, raised: boolean) {
    this.socket?.emit('meeting:hand-raise', { meetingId, raised });
  }

  sendMeetingMobileDevice(meetingId: number, mobile: boolean) {
    this.socket?.emit('meeting:mobile-device', { meetingId, mobile });
  }

  sendMeetingChatMessage(meetingId: number, message: string) {
    this.socket?.emit('meeting:chat-message', { meetingId, message });
  }

  kickMeetingParticipant(meetingId: number, targetSocketId: string) {
    this.socket?.emit('meeting:kick', { meetingId, targetSocketId });
  }

  muteMeetingParticipant(meetingId: number, targetSocketId: string) {
    this.socket?.emit('meeting:mute-participant', { meetingId, targetSocketId });
  }

  endMeetingForEveryone(meetingId: number) {
    this.socket?.emit('meeting:end', { meetingId });
  }
}
