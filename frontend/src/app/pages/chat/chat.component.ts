import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { SocketService, IncomingCall } from '../../core/services/socket.service';
import { ContactData, Message } from '../../models/message.model';
import { User } from '../../models/user.model';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('msgEnd')      msgEnd!:      ElementRef;
  @ViewChild('localVideo')  localVideo!:  ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('imageInput')  imageInput!:  ElementRef<HTMLInputElement>;

  contacts: ContactData[] = [];
  selected: ContactData | null = null;
  messages: Message[] = [];
  messageText = '';

  onlineUsers = new Set<string>();
  messagesLoading = false;
  imageUploading = false;
  callNotice = '';

  // ── Call state ────────────────────────────────────────────────
  callState: 'idle' | 'calling' | 'incoming' | 'in-call' = 'idle';
  callType:  'audio' | 'video' = 'video';
  callWith:  string | null = null;
  incomingCall: IncomingCall | null = null;

  isMuted    = false;
  isCamOff   = false;

  private localStream:  MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;
  private pendingOffer: { from: string; offer: RTCSessionDescriptionInit } | null = null;
  private callTimeout: any;

  private subs = new Subscription();
  private me: User | null = null;

  constructor(
    private auth: AuthService,
    private chatSvc: ChatService,
    public  socketSvc: SocketService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.me = this.auth.getUser();
    const token = this.auth.getToken();
    if (token) this.socketSvc.connect(token);

    this.loadContacts();
    this.subscribeToSocket();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.cleanupCall();
    this.socketSvc.disconnect();
  }

  // ── Contacts ──────────────────────────────────────────────────
  loadContacts() {
    this.chatSvc.getContacts().subscribe({
      next: (c) => (this.contacts = c),
    });
  }

  selectContact(c: ContactData) {
    this.selected = c;
    c.unreadCount = 0;
    this.messagesLoading = true;
    const uid = (c.user._id ?? c.user.id) as string;
    this.chatSvc.getMessages(uid).subscribe({
      next: (msgs) => {
        this.messages = msgs;
        this.messagesLoading = false;
        this.scrollToBottom();
      },
    });
  }

  get myId(): string {
    return (this.me?._id ?? this.me?.id ?? '') as string;
  }

  isMine(msg: Message): boolean {
    const sid = msg.sender?._id ?? (msg.sender as any)?.id;
    return sid === this.myId;
  }

  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  contactId(c: ContactData): string {
    return (c.user._id ?? c.user.id) as string;
  }

  avatarUrl(user: User): string | null {
    return this.auth.avatarUrl(user);
  }

  // ── Messaging ─────────────────────────────────────────────────
  sendMessage() {
    const text = this.messageText.trim();
    if (!text || !this.selected) return;
    const to = this.contactId(this.selected);
    this.socketSvc.sendMessage(to, text);
    this.messageText = '';
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  triggerImageInput() {
    this.imageInput.nativeElement.value = '';
    this.imageInput.nativeElement.click();
  }

  onImageSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.selected) return;
    this.imageUploading = true;
    this.chatSvc.uploadImage(file).subscribe({
      next: ({ url }) => {
        const to = this.contactId(this.selected!);
        this.socketSvc.sendMessage(to, '', 'image', url);
        this.imageUploading = false;
      },
      error: () => (this.imageUploading = false),
    });
  }

  imageFullUrl(path: string): string {
    return this.chatSvc.fileUrl(path);
  }

  openImage(url: string) {
    window.open(url, '_blank');
  }

  private scrollToBottom() {
    setTimeout(() => this.msgEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  // ── Socket subscriptions ───────────────────────────────────────
  private subscribeToSocket() {
    this.subs.add(
      this.socketSvc.message$.subscribe((msg) => {
        const senderId = msg.sender?._id ?? (msg.sender as any)?.id;
        if (this.selected && senderId === this.contactId(this.selected)) {
          this.messages.push(msg);
          this.scrollToBottom();
        } else {
          const c = this.contacts.find((c) => this.contactId(c) === senderId);
          if (c) {
            c.unreadCount++;
            c.lastMessage = msg;
          }
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.messageSent$.subscribe((msg) => {
        this.messages.push(msg);
        if (this.selected) {
          const c = this.contacts.find((c) => this.contactId(c) === this.contactId(this.selected!));
          if (c) c.lastMessage = msg;
        }
        this.scrollToBottom();
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.onlineUsers$.subscribe((ids) => {
        this.onlineUsers = new Set(ids);
        this.cdr.detectChanges();
      })
    );

    // Call events
    this.subs.add(this.socketSvc.callIncoming$.subscribe((d) => this.onCallIncoming(d)));
    this.subs.add(this.socketSvc.callAccepted$.subscribe(() => this.onCallAccepted()));
    this.subs.add(this.socketSvc.callRejected$.subscribe(() => this.onCallRejected()));
    this.subs.add(this.socketSvc.callEnded$.subscribe(() => this.onCallEnded()));
    this.subs.add(this.socketSvc.callOffline$.subscribe(() => this.onCallOffline()));
    this.subs.add(this.socketSvc.callOffer$.subscribe((d) => this.onCallOffer(d)));
    this.subs.add(this.socketSvc.callAnswer$.subscribe((d) => this.onCallAnswer(d)));
    this.subs.add(this.socketSvc.iceCandidate$.subscribe((d) => this.onIceCandidate(d)));
  }

  // ── Initiate call ─────────────────────────────────────────────
  async startCall(type: 'audio' | 'video') {
    if (!this.selected || this.callState !== 'idle') return;
    this.callType  = type;
    this.callWith  = this.contactId(this.selected);
    this.callState = 'calling';

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video',
      });
      this.attachLocal();
      this.createPeerConnection();
      this.socketSvc.requestCall(
        this.callWith,
        this.me?.username ?? 'Someone',
        type
      );
      this.callTimeout = setTimeout(() => {
        if (this.callState === 'calling') this.cancelCall();
      }, 30000);
    } catch (err) {
      this.cleanupCall();
      this.showCallNotice('Could not access your camera or microphone.');
    }
    this.cdr.detectChanges();
  }

  cancelCall() {
    if (this.callWith) this.socketSvc.endCall(this.callWith);
    this.cleanupCall();
  }

  // ── Incoming call ─────────────────────────────────────────────
  private onCallIncoming(data: IncomingCall) {
    if (this.callState !== 'idle') {
      this.socketSvc.rejectCall(data.from);
      return;
    }
    this.incomingCall = data;
    this.callState = 'incoming';
    this.cdr.detectChanges();
  }

  async acceptCall() {
    if (!this.incomingCall) return;
    this.callWith  = this.incomingCall.from;
    this.callType  = this.incomingCall.callType;
    this.incomingCall = null;
    this.callState = 'in-call';
    this.cdr.detectChanges();

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: this.callType === 'video',
      });
      this.createPeerConnection();
      this.attachLocal();
      this.socketSvc.acceptCall(this.callWith);

      if (this.pendingOffer) {
        const offer = this.pendingOffer;
        this.pendingOffer = null;
        await this.answerOffer(offer);
      }
    } catch (err) {
      const caller = this.callWith;
      if (caller) this.socketSvc.rejectCall(caller);
      this.cleanupCall();
      this.showCallNotice('Could not access your camera or microphone.');
    }
  }

  rejectCall() {
    if (this.incomingCall) this.socketSvc.rejectCall(this.incomingCall.from);
    this.incomingCall = null;
    this.callState = 'idle';
  }

  endCall() {
    if (this.callWith) this.socketSvc.endCall(this.callWith);
    this.cleanupCall();
  }

  // ── WebRTC signaling ──────────────────────────────────────────
  private async onCallAccepted() {
    clearTimeout(this.callTimeout);
    this.callState = 'in-call';
    this.cdr.detectChanges();
    this.attachLocal();
    if (!this.pc || !this.callWith) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socketSvc.sendOffer(this.callWith, offer);
    this.cdr.detectChanges();
  }

  private onCallRejected() {
    this.cleanupCall();
    this.callNotice = `${this.selected?.user?.username ?? 'User'} declined the call.`;
    setTimeout(() => (this.callNotice = ''), 3500);
    this.cdr.detectChanges();
  }

  private onCallEnded() {
    this.cleanupCall();
    this.cdr.detectChanges();
  }

  private onCallOffline() {
    this.cleanupCall();
    this.callNotice = `${this.selected?.user?.username ?? 'User'} is not available right now.`;
    setTimeout(() => (this.callNotice = ''), 3500);
    this.cdr.detectChanges();
  }

  private async onCallOffer(data: { from: string; offer: RTCSessionDescriptionInit }) {
    if (!this.pc) {
      this.pendingOffer = data;
      return;
    }

    await this.answerOffer(data);
  }

  private async answerOffer(data: { from: string; offer: RTCSessionDescriptionInit }) {
    if (!this.pc) {
      this.pendingOffer = data;
      return;
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    await this.processPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.socketSvc.sendAnswer(this.callWith ?? data.from, answer);
  }

  private async onCallAnswer(data: { answer: RTCSessionDescriptionInit }) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    await this.processPendingCandidates();
  }

  private async onIceCandidate(data: { candidate: RTCIceCandidateInit }) {
    if (this.pc && this.remoteDescSet) {
      await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } else {
      this.pendingCandidates.push(data.candidate);
    }
  }

  private async processPendingCandidates() {
    this.remoteDescSet = true;
    for (const c of this.pendingCandidates) {
      await this.pc?.addIceCandidate(new RTCIceCandidate(c));
    }
    this.pendingCandidates = [];
  }

  // ── Call helpers ──────────────────────────────────────────────
  private createPeerConnection() {
    this.pc?.close();
    this.remoteDescSet = false;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const pc = this.pc;
    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate && this.callWith) {
        this.socketSvc.sendIceCandidate(this.callWith, e.candidate);
      }
    };

    pc.ontrack = (e) => {
      if (e.streams[0]) {
        this.remoteStream = e.streams[0];
      } else {
        this.remoteStream ??= new MediaStream();
        this.remoteStream.addTrack(e.track);
      }
      this.attachRemote();
      this.cdr.detectChanges();
    };
  }

  private attachLocal() {
    setTimeout(() => {
      const video = this.localVideo?.nativeElement;
      if (video && this.localStream && video.srcObject !== this.localStream) {
        video.srcObject = this.localStream;
        void video.play().catch(() => {});
      }
    });
  }

  private attachRemote() {
    setTimeout(() => {
      const video = this.remoteVideo?.nativeElement;
      if (video && this.remoteStream && video.srcObject !== this.remoteStream) {
        video.srcObject = this.remoteStream;
        void video.play().catch(() => {});
      }
    });
  }

  private cleanupCall() {
    clearTimeout(this.callTimeout);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.localStream  = null;
    this.remoteStream = null;
    this.pc           = null;
    this.pendingCandidates = [];
    this.remoteDescSet = false;
    this.pendingOffer = null;
    this.callState    = 'idle';
    this.callWith     = null;
    this.incomingCall = null;
    this.isMuted      = false;
    this.isCamOff     = false;
  }

  private showCallNotice(message: string) {
    this.callNotice = message;
    setTimeout(() => (this.callNotice = ''), 3500);
    this.cdr.detectChanges();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !this.isMuted));
  }

  toggleCamera() {
    this.isCamOff = !this.isCamOff;
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !this.isCamOff));
  }

  // ── Utilities ─────────────────────────────────────────────────
  formatTime(date: string): string {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(date: string): string {
    const d = new Date(date);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  showDateSeparator(messages: Message[], index: number): boolean {
    if (index === 0) return true;
    const prev = new Date(messages[index - 1].createdAt).toDateString();
    const curr = new Date(messages[index].createdAt).toDateString();
    return prev !== curr;
  }

  roleIcon(role: string): string {
    const m: Record<string, string> = {
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      Employee: 'bi-person-fill',
    };
    return m[role] ?? 'bi-person-fill';
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }
}
