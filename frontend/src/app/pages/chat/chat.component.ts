import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { SocketService, IncomingCall } from '../../core/services/socket.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { ContactData, Message } from '../../models/message.model';
import { User } from '../../models/user.model';
import { ContextMenuComponent, ContextMenuItem } from '../../shared/context-menu/context-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { EMOJI_CATEGORIES } from '../../shared/emoji-data';


@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, ContextMenuComponent, ConfirmDialogComponent],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('msgEnd')      msgEnd!:      ElementRef;
  @ViewChild('localVideo')  localVideo!:  ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('imageInput')  imageInput!:  ElementRef<HTMLInputElement>;
  @ViewChild('chatInput')   chatInput!:   ElementRef<HTMLTextAreaElement>;
  @ViewChild('chatSearchInput') chatSearchInput!: ElementRef<HTMLInputElement>;

  contacts: ContactData[] = [];
  selected: ContactData | null = null;
  messages: Message[] = [];
  messageText = '';

  // ── Contact search ───────────────────────────────────────────
  contactSearchQuery = '';

  // ── In-chat message search ──────────────────────────────────
  showChatSearch = false;
  chatSearchQuery = '';
  chatSearchMatchIds: number[] = [];
  chatSearchActiveIdx = -1;

  onlineUsers = new Set<string>();
  messagesLoading = false;
  imageUploading  = false;
  callNotice      = '';
  mobileShowChat  = false;
  showProfileCard = false;

  // ── Context menu ─────────────────────────────────────────────
  menuVisible = false;
  menuX = 0;
  menuY = 0;
  menuItems: ContextMenuItem[] = [];
  private menuTarget: 'message' | 'contact' | 'profile' | null = null;
  private menuTargetId: string | number | null = null;

  replyingTo: Message | null = null;
  editingMessage: Message | null = null;

  showConfirm = false;
  confirmTitle = 'Confirm';
  confirmMessage = 'This action cannot be undone.';
  confirmLabel = 'Confirm';
  private pendingConfirmAction: (() => void) | null = null;

  // ── Sidebar tabs ──────────────────────────────────────────────
  sidebarTab: 'chat' | 'calls' = 'chat';
  callHistory: Message[] = [];
  callHistoryLoading = false;

  // ── Emoji picker ──────────────────────────────────────────────
  showEmojiPicker = false;
  activeCatIdx = 0;

  readonly emojiCategories = EMOJI_CATEGORIES;

  // ── Call state ────────────────────────────────────────────────
  callState: 'idle' | 'calling' | 'incoming' | 'in-call' = 'idle';
  callType:  'audio' | 'video' = 'video';
  callWith:  string | null = null;
  incomingCall: IncomingCall | null = null;

  private callId:     string | null = null;
  private iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

  isMuted      = false;
  isCamOff     = false;
  remoteMuted  = false;

  // ── Call timer ────────────────────────────────────────────────
  callElapsed = 0;
  private callTimerInterval: any = null;
  private callStartTime: number | null = null;

  private localStream:  MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;
  private pendingOffer: { from: string; offer: RTCSessionDescriptionInit; callId: string } | null = null;
  private callTimeout: any;

  private readonly ringAudio     = Object.assign(new Audio('/assets/ring.mp3'),     { loop: true, preload: 'auto' });
  private readonly ringtoneAudio = Object.assign(new Audio('/assets/ringtone.mp3'), { loop: true, preload: 'auto' });
  private audioUnlocked = false;

  private subs = new Subscription();
  private me: User | null = null;

  constructor(
    private auth: AuthService,
    private chatSvc: ChatService,
    public  socketSvc: SocketService,
    private cdr: ChangeDetectorRef,
    private dateFormat: DateFormatService,
  ) {}

  ngOnInit() {
    this.me = this.auth.getUser();

    this.chatSvc.getIceServers().subscribe({
      next: ({ iceServers }) => { this.iceServers = iceServers; },
    });
    this.loadContacts();
    this.subscribeToSocket();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.cleanupCall();
  }

  @HostListener('document:click')
  onDocumentClick() {
    if (this.showEmojiPicker) {
      this.showEmojiPicker = false;
      this.cdr.detectChanges();
    }
    if (this.menuVisible) {
      this.closeMenu();
    }
    this.unlockAudio();
  }

  private unlockAudio() {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    [this.ringAudio, this.ringtoneAudio].forEach((a) => {
      a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
    });
  }

  // ── Sidebar tabs ──────────────────────────────────────────────
  switchTab(tab: 'chat' | 'calls') {
    this.sidebarTab = tab;
    if (tab === 'calls' && this.callHistory.length === 0) {
      this.loadCallHistory();
    }
  }

  loadCallHistory() {
    this.callHistoryLoading = true;
    this.chatSvc.getCallHistory().subscribe({
      next:  (calls) => { this.callHistory = calls; this.callHistoryLoading = false; },
      error: ()      => { this.callHistoryLoading = false; },
    });
  }

  selectFromCallHistory(call: Message) {
    const other = this.isMine(call) ? call.receiver : call.sender;
    const otherId = String(other.id);
    const contact = this.contacts.find((c) => this.contactId(c) === otherId);
    if (contact) {
      this.sidebarTab = 'chat';
      this.selectContact(contact);
    }
  }

  // ── Contacts ──────────────────────────────────────────────────
  loadContacts() {
    const cached = this.chatSvc.contacts();
    if (cached.length) {
      this.contacts = cached;
      this.chatSvc.totalUnread.set(cached.reduce((s, c) => s + (c.unreadCount || 0), 0));
    }
    this.chatSvc.getContacts().subscribe({
      next: (c) => {
        this.contacts = c;
        this.chatSvc.totalUnread.set(c.reduce((s, c) => s + (c.unreadCount || 0), 0));
      },
    });
  }

  get filteredContacts(): ContactData[] {
    const q = this.contactSearchQuery.trim().toLowerCase();
    if (!q) return this.contacts;
    return this.contacts.filter((c) => c.user.username.toLowerCase().includes(q));
  }

  backToContacts() {
    this.mobileShowChat = false;
  }

  selectContact(c: ContactData) {
    this.selected = c;
    this.mobileShowChat  = true;
    this.showProfileCard = false;
    this.closeChatSearch();
    this.chatSvc.totalUnread.update(n => Math.max(0, n - (c.unreadCount || 0)));
    c.unreadCount = 0;
    this.messagesLoading = true;
    const uid = String(c.user.id);
    this.socketSvc.markSeen(uid);
    this.chatSvc.getMessages(uid).subscribe({
      next: (msgs) => {
        this.messages = msgs;
        this.messagesLoading = false;
        this.scrollToBottom();
      },
    });
  }

  get myId(): number {
    return this.me?.id ?? 0;
  }

  isMine(msg: Message): boolean {
    return msg.sender?.id === this.myId;
  }

  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId);
  }

  isUserOnline(user: User): boolean {
    return this.onlineUsers.has(String(user.id));
  }

  contactId(c: ContactData): string {
    return String(c.user.id);
  }

  private brokenAvatarIds = new Set<number>();

  onAvatarError(userId: number) {
    this.brokenAvatarIds.add(userId);
    this.cdr.detectChanges();
  }

  avatarUrl(user: User): string | null {
    if (this.brokenAvatarIds.has(user.id)) return null;
    return this.auth.avatarUrl(user);
  }

  // ── Messaging ─────────────────────────────────────────────────
  get isChatBlocked(): boolean {
    return !!(this.selected && (this.selected.isBlocked || this.selected.blockedByThem));
  }

  sendMessage() {
    const text = this.messageText.trim();
    if (!text || !this.selected || this.isChatBlocked) return;
    const to = this.contactId(this.selected);

    if (this.editingMessage) {
      this.socketSvc.editMessage(String(this.editingMessage.id), text);
      this.editingMessage = null;
    } else {
      const replyTo = this.replyingTo ? String(this.replyingTo.id) : undefined;
      this.socketSvc.sendMessage(to, text, 'text', undefined, replyTo);
      this.replyingTo = null;
    }
    this.messageText = '';
  }

  cancelReply() {
    this.replyingTo = null;
  }

  cancelEdit() {
    this.editingMessage = null;
    this.messageText = '';
  }

  // ── Context menu ──────────────────────────────────────────────
  private positionMenu(clientX: number, clientY: number) {
    this.menuX = clientX;
    this.menuY = clientY;
    this.menuVisible = true;
  }

  closeMenu() {
    this.menuVisible = false;
    this.menuTarget = null;
    this.menuTargetId = null;
  }

  private static readonly DELETE_FOR_ALL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

  canDeleteForEveryone(msg: Message): boolean {
    return Date.now() - new Date(msg.createdAt).getTime() <= ChatComponent.DELETE_FOR_ALL_WINDOW_MS;
  }

  openMessageMenu(event: MouseEvent, msg: Message) {
    event.preventDefault();
    event.stopPropagation();
    if (msg.type === 'call' || msg.isDeleted) return;

    const mine = this.isMine(msg);
    const items: ContextMenuItem[] = [{ label: 'Reply', icon: 'bi-reply-fill', action: 'reply' }];
    if (msg.type === 'text') {
      items.push({ label: 'Copy', icon: 'bi-clipboard', action: 'copy' });
    }
    items.push({ label: msg.isPinned ? 'Unpin' : 'Pin', icon: 'bi-pin-angle-fill', action: 'pin' });
    if (mine && msg.type === 'text') {
      items.push({ label: 'Edit', icon: 'bi-pencil-fill', action: 'edit' });
    }
    items.push({ label: 'Delete', icon: 'bi-trash', action: 'delete', danger: true });
    if (mine && this.canDeleteForEveryone(msg)) {
      items.push({ label: 'Delete for everyone', icon: 'bi-trash-fill', action: 'deleteAll', danger: true });
    }

    this.menuTarget = 'message';
    this.menuTargetId = msg.id;
    this.menuItems = items;
    this.positionMenu(event.clientX, event.clientY);
  }

  openContactMenu(event: MouseEvent, c: ContactData) {
    event.preventDefault();
    event.stopPropagation();
    this.menuTarget = 'contact';
    this.menuTargetId = this.contactId(c);
    this.menuItems = [
      { label: 'Clear Chat', icon: 'bi-x-circle', action: 'clear' },
      { label: c.isMuted ? 'Unmute' : 'Mute', icon: c.isMuted ? 'bi-bell-fill' : 'bi-bell-slash-fill', action: 'mute' },
    ];
    this.positionMenu(event.clientX, event.clientY);
  }

  openProfileMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.selected) return;
    this.menuTarget = 'profile';
    this.menuTargetId = this.contactId(this.selected);
    this.menuItems = [
      { label: 'Clear Chat', icon: 'bi-x-circle', action: 'clear' },
      {
        label: this.selected.isBlocked ? 'Unblock' : 'Block',
        icon: 'bi-slash-circle',
        action: 'block',
        danger: !this.selected.isBlocked,
      },
    ];
    this.positionMenu(event.clientX, event.clientY);
  }

  onMenuAction(action: string) {
    const target = this.menuTarget;
    const targetId = this.menuTargetId;

    if (target === 'message') {
      const msg = this.messages.find((m) => m.id === targetId);
      if (!msg) return;
      this.handleMessageMenuAction(action, msg);
    } else if (target === 'contact') {
      const c = this.contacts.find((c) => this.contactId(c) === targetId);
      if (!c) return;
      this.handleContactMenuAction(action, c);
    } else if (target === 'profile') {
      this.handleProfileMenuAction(action);
    }
  }

  private handleMessageMenuAction(action: string, msg: Message) {
    switch (action) {
      case 'reply':
        this.replyingTo = msg;
        this.editingMessage = null;
        setTimeout(() => this.chatInput?.nativeElement?.focus());
        break;
      case 'copy':
        navigator.clipboard?.writeText(msg.content);
        break;
      case 'pin':
        this.socketSvc.pinMessage(String(msg.id), !msg.isPinned);
        break;
      case 'edit':
        this.editingMessage = msg;
        this.replyingTo = null;
        this.messageText = msg.content;
        setTimeout(() => this.chatInput?.nativeElement?.focus());
        break;
      case 'delete':
        this.openConfirm(
          'Delete message?',
          'This message will be deleted for you.',
          'Delete',
          () => this.socketSvc.deleteMessage(String(msg.id), false)
        );
        break;
      case 'deleteAll':
        this.openConfirm(
          'Delete for everyone?',
          'This message will be deleted for everyone in this chat.',
          'Delete',
          () => this.socketSvc.deleteMessage(String(msg.id), true)
        );
        break;
    }
  }

  private handleContactMenuAction(action: string, c: ContactData) {
    if (action === 'clear') {
      this.openConfirm(
        'Clear chat?',
        `All messages with ${c.user.username} will be cleared for you.`,
        'Clear',
        () => this.clearChatWith(c)
      );
    } else if (action === 'mute') {
      this.chatSvc.toggleMute(this.contactId(c)).subscribe({
        next: ({ muted }) => { c.isMuted = muted; this.cdr.detectChanges(); },
      });
    }
  }

  private handleProfileMenuAction(action: string) {
    if (!this.selected) return;
    const selected = this.selected;

    if (action === 'clear') {
      this.openConfirm(
        'Clear chat?',
        `All messages with ${selected.user.username} will be cleared for you.`,
        'Clear',
        () => this.clearChatWith(selected)
      );
    } else if (action === 'block') {
      const blocking = !selected.isBlocked;
      this.openConfirm(
        blocking ? 'Block this contact?' : 'Unblock this contact?',
        blocking
          ? `You won't be able to send or receive messages from ${selected.user.username}.`
          : `You will be able to message ${selected.user.username} again.`,
        blocking ? 'Block' : 'Unblock',
        () => {
          this.chatSvc.toggleBlock(this.contactId(selected)).subscribe({
            next: ({ blocked }) => {
              selected.isBlocked = blocked;
              const c = this.contacts.find((c) => this.contactId(c) === this.contactId(selected));
              if (c) c.isBlocked = blocked;
              this.cdr.detectChanges();
            },
          });
        }
      );
    }
  }

  private clearChatWith(c: ContactData) {
    this.chatSvc.clearChat(this.contactId(c)).subscribe({
      next: () => {
        c.lastMessage = null;
        if (this.selected && this.contactId(this.selected) === this.contactId(c)) {
          this.messages = [];
        }
        this.cdr.detectChanges();
      },
    });
  }

  private openConfirm(title: string, message: string, confirmLabel: string, action: () => void) {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.confirmLabel = confirmLabel;
    this.pendingConfirmAction = action;
    this.showConfirm = true;
  }

  onConfirmed() {
    this.pendingConfirmAction?.();
    this.pendingConfirmAction = null;
    this.showConfirm = false;
  }

  onConfirmCancelled() {
    this.pendingConfirmAction = null;
    this.showConfirm = false;
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
    if (!file || !this.selected || this.isChatBlocked) return;
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

  toggleEmojiPicker(event: MouseEvent) {
    event.stopPropagation();
    this.showEmojiPicker = !this.showEmojiPicker;
  }

  insertEmoji(event: MouseEvent, emoji: string) {
    event.stopPropagation();
    const el = this.chatInput?.nativeElement;
    if (el) {
      const start = el.selectionStart ?? this.messageText.length;
      const end   = el.selectionEnd   ?? this.messageText.length;
      this.messageText = this.messageText.slice(0, start) + emoji + this.messageText.slice(end);
      setTimeout(() => { el.focus(); el.setSelectionRange(start + [...emoji].length, start + [...emoji].length); });
    } else {
      this.messageText += emoji;
    }
  }

  private scrollToBottom() {
    setTimeout(() => this.msgEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  // ── In-chat message search ──────────────────────────────────────
  toggleChatSearch() {
    this.showChatSearch = !this.showChatSearch;
    if (!this.showChatSearch) {
      this.closeChatSearch();
    } else {
      setTimeout(() => this.chatSearchInput?.nativeElement?.focus());
    }
  }

  closeChatSearch() {
    this.showChatSearch = false;
    this.chatSearchQuery = '';
    this.chatSearchMatchIds = [];
    this.chatSearchActiveIdx = -1;
  }

  onChatSearchInput() {
    const q = this.chatSearchQuery.trim().toLowerCase();
    if (!q) {
      this.chatSearchMatchIds = [];
      this.chatSearchActiveIdx = -1;
      return;
    }
    this.chatSearchMatchIds = this.messages
      .filter((m) => m.type === 'text' && !m.isDeleted && (m.content || '').toLowerCase().includes(q))
      .map((m) => m.id);
    this.chatSearchActiveIdx = this.chatSearchMatchIds.length ? 0 : -1;
    this.scrollToActiveMatch();
  }

  onChatSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) this.prevMatch();
    else this.nextMatch();
  }

  nextMatch() {
    if (!this.chatSearchMatchIds.length) return;
    this.chatSearchActiveIdx = (this.chatSearchActiveIdx + 1) % this.chatSearchMatchIds.length;
    this.scrollToActiveMatch();
  }

  prevMatch() {
    if (!this.chatSearchMatchIds.length) return;
    this.chatSearchActiveIdx = (this.chatSearchActiveIdx - 1 + this.chatSearchMatchIds.length) % this.chatSearchMatchIds.length;
    this.scrollToActiveMatch();
  }

  private scrollToActiveMatch() {
    const id = this.chatSearchMatchIds[this.chatSearchActiveIdx];
    if (!id) return;
    setTimeout(() => {
      document.getElementById('msg-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  isSearchMatch(msgId: number): boolean {
    return this.chatSearchMatchIds.includes(msgId);
  }

  isActiveSearchMatch(msgId: number): boolean {
    return this.chatSearchActiveIdx >= 0 && this.chatSearchMatchIds[this.chatSearchActiveIdx] === msgId;
  }

  // ── Socket subscriptions ───────────────────────────────────────
  private subscribeToSocket() {
    this.subs.add(
      this.socketSvc.message$.subscribe((msg) => {
        const senderId = String(msg.sender?.id ?? '');
        if (this.selected && senderId === this.contactId(this.selected)) {
          this.messages.push(msg);
          this.socketSvc.markSeen(senderId);
          this.scrollToBottom();
        } else {
          const c = this.contacts.find((c) => this.contactId(c) === senderId);
          if (c) {
            c.unreadCount++;
            c.lastMessage = msg;
            this.chatSvc.totalUnread.update(n => n + 1);
          }
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.messageDelivered$.subscribe(({ by }) => {
        this.messages.forEach((m) => {
          if (this.isMine(m) && !m.delivered) {
            const receiverId = String(m.receiver?.id ?? '');
            if (receiverId === by) m.delivered = true;
          }
        });
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.messageSeen$.subscribe(({ by }) => {
        this.messages.forEach((m) => {
          if (this.isMine(m)) {
            const receiverId = String(m.receiver?.id ?? '');
            if (receiverId === by) { m.delivered = true; m.read = true; }
          }
        });
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

    this.subs.add(
      this.socketSvc.messageEdited$.subscribe((msg) => {
        const idx = this.messages.findIndex((m) => m.id === msg.id);
        if (idx >= 0) this.messages[idx] = msg;
        if (this.selected) {
          const otherId = this.isMine(msg) ? String(msg.receiver?.id) : String(msg.sender?.id);
          const c = this.contacts.find((c) => this.contactId(c) === otherId);
          if (c && c.lastMessage?.id === msg.id) c.lastMessage = msg;
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.messageDeleted$.subscribe(({ messageId, forAll }) => {
        const id = Number(messageId);
        if (forAll) {
          const msg = this.messages.find((m) => m.id === id);
          if (msg) { msg.isDeleted = true; msg.content = ''; msg.fileUrl = null; }
        } else {
          this.messages = this.messages.filter((m) => m.id !== id);
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.messagePinned$.subscribe(({ messageId, pinned }) => {
        const msg = this.messages.find((m) => m.id === Number(messageId));
        if (msg) msg.isPinned = pinned;
        this.cdr.detectChanges();
      })
    );

    // Call events
    this.subs.add(this.socketSvc.callSession$.subscribe(({ callId }) => { this.callId = callId; }));
    this.subs.add(this.socketSvc.callIncoming$.subscribe((d) => this.onCallIncoming(d)));
    this.subs.add(this.socketSvc.callAccepted$.subscribe(() => this.onCallAccepted()));
    this.subs.add(this.socketSvc.callRejected$.subscribe(() => this.onCallRejected()));
    this.subs.add(this.socketSvc.callEnded$.subscribe(() => this.onCallEnded()));
    this.subs.add(this.socketSvc.callOffline$.subscribe(() => this.onCallOffline()));
    this.subs.add(this.socketSvc.callOffer$.subscribe((d) => this.onCallOffer(d)));
    this.subs.add(this.socketSvc.callAnswer$.subscribe((d) => this.onCallAnswer(d)));
    this.subs.add(this.socketSvc.iceCandidate$.subscribe((d) => this.onIceCandidate(d)));
    this.subs.add(this.socketSvc.remoteMuted$.subscribe((m) => { this.remoteMuted = m; this.cdr.detectChanges(); }));

    // Call log — push into current conversation and call history
    this.subs.add(
      this.socketSvc.callLogged$.subscribe((msg) => {
        const otherId = this.isMine(msg) ? String(msg.receiver?.id) : String(msg.sender?.id);
        if (this.selected && this.contactId(this.selected) === otherId) {
          this.messages.push(msg);
          this.scrollToBottom();
        }
        if (this.sidebarTab === 'calls') {
          this.callHistory.unshift(msg);
        }
        this.cdr.detectChanges();
      })
    );
  }

  // ── Call timer ────────────────────────────────────────────────
  private startCallTimer() {
    this.stopCallTimer();
    this.callElapsed   = 0;
    this.callStartTime = Date.now();
    this.callTimerInterval = setInterval(() => {
      this.callElapsed = Math.floor((Date.now() - this.callStartTime!) / 1000);
      this.cdr.detectChanges();
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

  // ── Initiate call ─────────────────────────────────────────────
  async startCall(type: 'audio' | 'video') {
    if (!this.selected || this.callState !== 'idle' || this.isChatBlocked) return;
    this.callType  = type;
    this.callWith  = this.contactId(this.selected);
    this.callState = 'calling';

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video',
      });
      this.attachLocal();
      this.createPeerConnection();
      this.socketSvc.requestCall(
        this.callWith,
        this.me?.username ?? 'Someone',
        type
      );
      void this.ringAudio.play().catch(() => {});
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
    this.cdr.detectChanges();
  }

  async acceptCall() {
    if (!this.incomingCall) return;
    this.callId    = this.incomingCall.callId;
    this.callWith  = this.incomingCall.from;
    this.callType  = this.incomingCall.callType;
    this.incomingCall = null;
    this.callState = 'in-call';
    this.stopAllAudio();
    this.startCallTimer();
    this.cdr.detectChanges();

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: this.callType === 'video',
      });
      this.createPeerConnection();
      this.attachLocal();
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
    this.cdr.detectChanges();
    this.attachLocal();
    if (!this.pc || !this.callId) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socketSvc.sendOffer(this.callId, offer);
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

  private async onCallOffer(data: { from: string; offer: RTCSessionDescriptionInit; callId: string }) {
    if (!this.pc) {
      this.pendingOffer = data;
      return;
    }

    await this.answerOffer(data);
  }

  private async answerOffer(data: { from: string; offer: RTCSessionDescriptionInit; callId: string }) {
    if (!this.pc) {
      this.pendingOffer = data;
      return;
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    await this.processPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.socketSvc.sendAnswer(data.callId, answer);
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
    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

    const pc = this.pc;
    this.localStream?.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate && this.callId) {
        this.socketSvc.sendIceCandidate(this.callId, e.candidate);
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
        video.muted = true;
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

  private stopAllAudio() {
    [this.ringAudio, this.ringtoneAudio].forEach((a) => { a.pause(); a.currentTime = 0; });
  }

  private cleanupCall() {
    clearTimeout(this.callTimeout);
    this.stopCallTimer();
    this.stopAllAudio();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.localStream  = null;
    this.remoteStream = null;
    this.pc           = null;
    this.pendingCandidates = [];
    this.remoteDescSet = false;
    this.pendingOffer = null;
    this.callState    = 'idle';
    this.callId       = null;
    this.callWith     = null;
    this.incomingCall = null;
    this.isMuted      = false;
    this.isCamOff     = false;
    this.remoteMuted  = false;
  }

  private showCallNotice(message: string) {
    this.callNotice = message;
    setTimeout(() => (this.callNotice = ''), 3500);
    this.cdr.detectChanges();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !this.isMuted));
    if (this.callId) this.socketSvc.sendMuteState(this.callId, this.isMuted);
  }

  toggleCamera() {
    this.isCamOff = !this.isCamOff;
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = !this.isCamOff));
  }

  // ── Utilities ─────────────────────────────────────────────────
  formatTime(date: string): string {
    return this.dateFormat.formatTime(date);
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

  formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  showDateSeparator(messages: Message[], index: number): boolean {
    if (index === 0) return true;
    const prev = new Date(messages[index - 1].createdAt).toDateString();
    const curr = new Date(messages[index].createdAt).toDateString();
    return prev !== curr;
  }

  callStatusLabel(msg: Message): string {
    const mine = this.isMine(msg);
    switch (msg.callStatus) {
      case 'completed': return mine ? 'Outgoing call' : 'Incoming call';
      case 'missed':    return mine ? 'No answer'     : 'Missed call';
      case 'rejected':  return mine ? 'Call declined' : 'Declined';
      default:          return 'Call';
    }
  }

  callDirectionIcon(msg: Message): string {
    if (msg.callStatus === 'missed' || msg.callStatus === 'rejected') {
      return 'bi-telephone-missed-fill';
    }
    return this.isMine(msg) ? 'bi-arrow-up-right' : 'bi-arrow-down-left';
  }

  callHistoryOther(msg: Message): User {
    return this.isMine(msg) ? msg.receiver : msg.sender;
  }

  roleIcon(role: string): string {
    const m: Record<string, string> = {
      Admin: 'bi-shield-fill-check',
      Manager: 'bi-briefcase-fill',
      'Team Lead': 'bi-diagram-3-fill',
      User: 'bi-person-fill',
    };
    return m[role] ?? 'bi-person-fill';
  }

  roleClass(role: string): string {
    return role.toLowerCase().replace(' ', '-');
  }
}
