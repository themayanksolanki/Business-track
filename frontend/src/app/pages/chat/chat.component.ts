import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ChatService } from '../../core/services/chat.service';
import { SocketService } from '../../core/services/socket.service';
import { CallSessionService } from '../../core/services/call-session.service';
import { DateFormatService } from '../../core/services/date-format.service';
import { GroupService } from '../../core/services/group.service';
import { MeetingService } from '../../core/services/meeting.service';
import { ContactData, Message } from '../../models/message.model';
import { User } from '../../models/user.model';
import { Group, GroupWithActivity, GroupMessage } from '../../models/group.model';
import { ContextMenuComponent, ContextMenuItem } from '../../shared/context-menu/context-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { CreateGroupDialogComponent } from '../../shared/create-group-dialog/create-group-dialog.component';
import { GroupMembersDialogComponent } from '../../shared/group-members-dialog/group-members-dialog.component';
import { EMOJI_CATEGORIES } from '../../shared/emoji-data';


@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ContextMenuComponent, ConfirmDialogComponent,
    CreateGroupDialogComponent, GroupMembersDialogComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.css',
})
export class ChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesArea') messagesArea!: ElementRef<HTMLDivElement>;
  @ViewChild('imageInput')  imageInput!:  ElementRef<HTMLInputElement>;
  @ViewChild('chatInput')   chatInput!:   ElementRef<HTMLTextAreaElement>;
  @ViewChild('chatSearchInput') chatSearchInput!: ElementRef<HTMLInputElement>;

  contacts: ContactData[] = [];
  selected: ContactData | null = null;
  messages: Message[] = [];
  /* Newest-first mirror of `messages`, kept in sync by syncReversed() — the
     template renders this inside a column-reverse container so the chat opens
     pinned to the latest message like WhatsApp/Telegram. */
  reversedMessages: Message[] = [];
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
  mobileShowChat  = false;
  showProfileCard = false;

  // ── Context menu ─────────────────────────────────────────────
  menuVisible = false;
  menuX = 0;
  menuY = 0;
  menuItems: ContextMenuItem[] = [];
  private menuTarget: 'message' | 'contact' | 'profile' | 'groupMessage' | null = null;
  private menuTargetId: string | number | null = null;

  // Widened to also hold a GroupMessage while a group thread is open — the
  // reply/edit preview bars only ever read id/type/content/sender.username,
  // a shape both models share.
  replyingTo: Message | GroupMessage | null = null;
  editingMessage: Message | GroupMessage | null = null;

  // ── Typing indicator ──────────────────────────────────────────
  otherTyping = false;
  private isTypingSent = false;
  private typingStopTimer: any;
  private typingIndicatorTimeout: any;

  showConfirm = false;
  confirmTitle = 'Confirm';
  confirmMessage = 'This action cannot be undone.';
  confirmLabel = 'Confirm';
  private pendingConfirmAction: (() => void) | null = null;

  // ── Sidebar tabs ──────────────────────────────────────────────
  sidebarTab: 'chat' | 'groups' | 'calls' = 'chat';
  callHistory: Message[] = [];
  callHistoryLoading = false;

  // ── Group chat ─────────────────────────────────────────────────
  groups: GroupWithActivity[] = [];
  groupsLoading = false;
  groupSearchQuery = '';
  selectedGroup: GroupWithActivity | null = null;
  groupMessages: GroupMessage[] = [];
  reversedGroupMessages: GroupMessage[] = [];
  groupMessagesLoading = false;
  otherGroupTyping = false;
  private groupTypingIndicatorTimeout: any;
  createGroupOpen = false;
  groupMembersOpen = false;

  // ── Emoji picker ──────────────────────────────────────────────
  showEmojiPicker = false;
  activeCatIdx = 0;

  readonly emojiCategories = EMOJI_CATEGORIES;

  private subs = new Subscription();
  private me: User | null = null;

  constructor(
    private auth: AuthService,
    private chatSvc: ChatService,
    public  socketSvc: SocketService,
    public  callSvc: CallSessionService,
    private cdr: ChangeDetectorRef,
    private dateFormat: DateFormatService,
    private sanitizer: DomSanitizer,
    private groupSvc: GroupService,
    private meetingSvc: MeetingService,
    private router: Router,
    private route: ActivatedRoute,
  ) {}

  ngOnInit() {
    this.me = this.auth.getUser();
    this.loadContacts();
    this.loadGroups();
    this.subscribeToSocket();
  }

  ngOnDestroy() {
    this.subs.unsubscribe();
    this.stopTyping();
    this.stopGroupTyping();
    clearTimeout(this.typingIndicatorTimeout);
    clearTimeout(this.groupTypingIndicatorTimeout);
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
    if (this.reactionPickerForId !== null) {
      this.reactionPickerForId = null;
      this.cdr.detectChanges();
    }
  }

  // ── Sidebar tabs ──────────────────────────────────────────────
  switchTab(tab: 'chat' | 'groups' | 'calls') {
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
    this.stopTyping();
    this.stopGroupTyping();
    this.selectedGroup = null;
    this.selected = c;
    this.mobileShowChat  = true;
    this.showProfileCard = false;
    this.replyingTo = null;
    this.editingMessage = null;
    this.messageText = '';
    this.otherTyping = false;
    clearTimeout(this.typingIndicatorTimeout);
    this.closeChatSearch();
    this.chatSvc.totalUnread.update(n => Math.max(0, n - (c.unreadCount || 0)));
    c.unreadCount = 0;
    this.messagesLoading = true;
    const uid = String(c.user.id);
    this.socketSvc.markSeen(uid);
    this.chatSvc.getMessages(uid).subscribe({
      next: (msgs) => {
        this.messages = msgs;
        this.syncReversed();
        this.messagesLoading = false;
        this.scrollToBottom();
      },
    });
  }

  private syncReversed() {
    this.reversedMessages = [...this.messages].reverse();
  }

  // ── Groups ────────────────────────────────────────────────────
  loadGroups() {
    this.groupsLoading = true;
    this.groupSvc.getGroups().subscribe({
      next: (groups) => {
        this.groups = groups;
        this.groupsLoading = false;
        this.resolvePendingGroupDeepLink();
      },
      error: () => { this.groupsLoading = false; },
    });
  }

  // Backs notification-triggered links (see NotificationsFeedService.linkFor)
  // — ?group=<id> has no other reader anywhere in the app, so this is the
  // only place it's ever consumed. Runs once, right after the group list
  // that a match is looked up against finishes loading.
  private resolvePendingGroupDeepLink() {
    const groupParam = this.route.snapshot.queryParamMap.get('group');
    if (!groupParam) return;
    const group = this.groups.find((g) => g.id === Number(groupParam));
    if (group) {
      this.switchTab('groups');
      this.selectGroup(group);
    }
    this.router.navigate([], { relativeTo: this.route, queryParams: { group: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  get filteredGroups(): GroupWithActivity[] {
    const q = this.groupSearchQuery.trim().toLowerCase();
    if (!q) return this.groups;
    return this.groups.filter((g) => g.name.toLowerCase().includes(q));
  }

  onGroupCreated(group: Group) {
    this.createGroupOpen = false;
    this.loadGroups();
    this.switchTab('groups');
    const withActivity: GroupWithActivity = { ...group, lastMessage: null, unreadCount: 0 };
    this.selectGroup(withActivity);
  }

  selectGroup(g: GroupWithActivity) {
    this.stopTyping();
    this.stopGroupTyping();
    this.selected = null;
    this.selectedGroup = g;
    this.mobileShowChat = true;
    this.showProfileCard = false;
    this.replyingTo = null;
    this.editingMessage = null;
    this.messageText = '';
    this.otherGroupTyping = false;
    clearTimeout(this.groupTypingIndicatorTimeout);
    this.closeChatSearch();
    g.unreadCount = 0;
    this.groupMessagesLoading = true;
    this.socketSvc.markGroupSeen(g.id);
    this.groupSvc.getMessages(g.id).subscribe({
      next: (msgs) => {
        this.groupMessages = msgs;
        this.syncReversedGroup();
        this.groupMessagesLoading = false;
        this.scrollToBottom();
      },
    });
  }

  private syncReversedGroup() {
    this.reversedGroupMessages = [...this.groupMessages].reverse();
  }

  isGroupMsgMine(msg: GroupMessage): boolean {
    return msg.sender?.id === this.myId;
  }

  // "Seen by everyone" — every member (including the sender, whose own
  // message auto-marks read) has a GroupMessageRead row.
  groupMsgSeenByAll(msg: GroupMessage): boolean {
    return !!this.selectedGroup && msg.reads.length >= this.selectedGroup.members.length;
  }

  sendGroupMessage() {
    const text = this.messageText.trim();
    if (!text || !this.selectedGroup) return;

    if (this.editingMessage) {
      this.socketSvc.editGroupMessage(String(this.editingMessage.id), text);
      this.editingMessage = null;
    } else {
      const replyTo = this.replyingTo ? String(this.replyingTo.id) : undefined;
      this.socketSvc.sendGroupMessage(this.selectedGroup.id, text, 'text', undefined, replyTo);
      this.replyingTo = null;
    }
    this.messageText = '';
    this.stopGroupTyping();
  }

  onGroupMessageInput() {
    if (!this.selectedGroup || !this.messageText.trim()) {
      this.stopGroupTyping();
      return;
    }
    if (!this.isGroupTypingSent) {
      this.socketSvc.sendGroupTyping(this.selectedGroup.id, true);
      this.isGroupTypingSent = true;
    }
    clearTimeout(this.groupTypingStopTimer);
    this.groupTypingStopTimer = setTimeout(() => this.stopGroupTyping(), 2000);
  }

  private isGroupTypingSent = false;
  private groupTypingStopTimer: any;

  private stopGroupTyping() {
    clearTimeout(this.groupTypingStopTimer);
    if (this.isGroupTypingSent && this.selectedGroup) {
      this.socketSvc.sendGroupTyping(this.selectedGroup.id, false);
    }
    this.isGroupTypingSent = false;
  }

  onGroupImageSelected(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !this.selectedGroup) return;
    this.imageUploading = true;
    this.chatSvc.uploadImage(file).subscribe({
      next: ({ url }) => {
        this.socketSvc.sendGroupMessage(this.selectedGroup!.id, '', 'image', url);
        this.imageUploading = false;
      },
      error: () => (this.imageUploading = false),
    });
  }

  openGroupMembers() {
    if (!this.selectedGroup) return;
    this.groupMembersOpen = true;
  }

  get canManageSelectedGroup(): boolean {
    if (!this.selectedGroup) return false;
    const user = this.auth.getUser();
    if (!user) return false;
    if (user.role === 'Admin') return true;
    if (this.selectedGroup.createdBy?.id === user.id) return true;
    return this.selectedGroup.members.some((m) => m.userId === user.id && m.role === 'admin');
  }

  onGroupUpdated(group: Group) {
    this.selectedGroup = { ...this.selectedGroup!, ...group };
    this.groups = this.groups.map((g) => (g.id === group.id ? { ...g, ...group } : g));
  }

  onGroupDeleted() {
    this.groupMembersOpen = false;
    this.groups = this.groups.filter((g) => g.id !== this.selectedGroup?.id);
    this.selectedGroup = null;
    this.replyingTo = null;
    this.editingMessage = null;
    this.messageText = '';
  }

  onLeftGroup() {
    this.groupMembersOpen = false;
    this.groups = this.groups.filter((g) => g.id !== this.selectedGroup?.id);
    this.selectedGroup = null;
    this.replyingTo = null;
    this.editingMessage = null;
    this.messageText = '';
  }

  get myId(): number {
    return this.me?.id ?? 0;
  }

  isMine(msg: { sender?: { id: number } }): boolean {
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
  sendMessage() {
    const text = this.messageText.trim();
    if (!text || !this.selected) return;
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
    this.stopTyping();
  }

  // ── Typing indicator ──────────────────────────────────────────
  onMessageInput() {
    if (!this.selected) {
      this.stopTyping();
      return;
    }
    if (!this.messageText.trim()) {
      this.stopTyping();
      return;
    }
    if (!this.isTypingSent) {
      this.socketSvc.sendTyping(this.contactId(this.selected), true);
      this.isTypingSent = true;
    }
    clearTimeout(this.typingStopTimer);
    // Debounced stop: treat a 2s pause with no keystrokes as "done typing"
    // in case the user never sends (switches tab, walks away, etc.).
    this.typingStopTimer = setTimeout(() => this.stopTyping(), 2000);
  }

  private stopTyping() {
    clearTimeout(this.typingStopTimer);
    if (this.isTypingSent && this.selected) {
      this.socketSvc.sendTyping(this.contactId(this.selected), false);
    }
    this.isTypingSent = false;
  }

  // ── Reactions ─────────────────────────────────────────────────
  reactionPickerForId: number | null = null;
  readonly quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  openReactionPicker(event: MouseEvent, msg: Message) {
    event.preventDefault();
    event.stopPropagation();
    this.reactionPickerForId = this.reactionPickerForId === msg.id ? null : msg.id;
  }

  react(event: MouseEvent, msg: Message, emoji: string) {
    event.stopPropagation();
    this.socketSvc.reactToMessage(String(msg.id), emoji);
    this.reactionPickerForId = null;
  }

  groupedReactions(msg: Message): { emoji: string; count: number; mine: boolean }[] {
    if (!msg.reactions?.length) return [];
    const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of msg.reactions) {
      const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      g.count++;
      if (r.userId === this.myId) g.mine = true;
      map.set(r.emoji, g);
    }
    return [...map.values()];
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

  canDeleteForEveryone(msg: { createdAt: string }): boolean {
    return Date.now() - new Date(msg.createdAt).getTime() <= ChatComponent.DELETE_FOR_ALL_WINDOW_MS;
  }

  openGroupMessageMenu(event: MouseEvent, msg: GroupMessage) {
    event.preventDefault();
    event.stopPropagation();
    if (msg.type === 'call' || msg.isDeleted) return;

    const mine = this.isGroupMsgMine(msg);
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

    this.menuTarget = 'groupMessage';
    this.menuTargetId = msg.id;
    this.menuItems = items;
    this.positionMenu(event.clientX, event.clientY);
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
    } else if (target === 'groupMessage') {
      const msg = this.groupMessages.find((m) => m.id === targetId);
      if (!msg) return;
      this.handleGroupMessageMenuAction(action, msg);
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

  private handleGroupMessageMenuAction(action: string, msg: GroupMessage) {
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
        this.socketSvc.pinGroupMessage(String(msg.id), !msg.isPinned);
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
          () => this.socketSvc.deleteGroupMessage(String(msg.id), false)
        );
        break;
      case 'deleteAll':
        this.openConfirm(
          'Delete for everyone?',
          'This message will be deleted for everyone in this group.',
          'Delete',
          () => this.socketSvc.deleteGroupMessage(String(msg.id), true)
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
    }
  }

  private clearChatWith(c: ContactData) {
    this.chatSvc.clearChat(this.contactId(c)).subscribe({
      next: () => {
        c.lastMessage = null;
        if (this.selected && this.contactId(this.selected) === this.contactId(c)) {
          this.messages = [];
          this.syncReversed();
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

  // Composer is shared between a DM thread and a group thread (only one of
  // selected/selectedGroup is ever set) — these three dispatch to whichever
  // is active instead of duplicating the input area's template.
  sendActiveMessage() {
    if (this.selectedGroup) this.sendGroupMessage();
    else this.sendMessage();
  }

  onActiveMessageInput() {
    if (this.selectedGroup) this.onGroupMessageInput();
    else this.onMessageInput();
  }

  onActiveImageSelected(event: Event) {
    if (this.selectedGroup) this.onGroupImageSelected(event);
    else this.onImageSelected(event);
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendActiveMessage();
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
    // messages-area is flex-direction: column-reverse, so scrollTop 0 is the
    // bottom (latest message) — no animated scrollIntoView flash needed.
    setTimeout(() => {
      const el = this.messagesArea?.nativeElement;
      if (el) el.scrollTop = 0;
    });
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
          this.syncReversed();
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
        const receiverId = String(msg.receiver?.id ?? '');
        const c = this.contacts.find((c) => this.contactId(c) === receiverId);
        if (c) c.lastMessage = msg;
        if (this.selected && receiverId === this.contactId(this.selected)) {
          this.messages.push(msg);
          this.syncReversed();
          this.scrollToBottom();
        }
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
        if (idx >= 0) { this.messages[idx] = msg; this.syncReversed(); }
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
          this.syncReversed();
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

    this.subs.add(
      this.socketSvc.messageReaction$.subscribe(({ messageId, reactions }) => {
        const msg = this.messages.find((m) => m.id === messageId);
        if (msg) msg.reactions = reactions;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.typing$.subscribe(({ from, isTyping }) => {
        if (!this.selected || from !== this.contactId(this.selected)) return;
        this.otherTyping = isTyping;
        clearTimeout(this.typingIndicatorTimeout);
        if (isTyping) {
          // Safety net if a typing:stop event is ever missed (e.g. the tab
          // closes without a clean disconnect) — auto-clear after a pause.
          this.typingIndicatorTimeout = setTimeout(() => {
            this.otherTyping = false;
            this.cdr.detectChanges();
          }, 4000);
        }
        this.cdr.detectChanges();
      })
    );

    // ── Group chat messages ──────────────────────────────────────
    this.subs.add(
      this.socketSvc.groupMessage$.subscribe((msg) => {
        if (this.selectedGroup && msg.groupId === this.selectedGroup.id) {
          this.groupMessages.push(msg);
          this.syncReversedGroup();
          this.socketSvc.markGroupSeen(msg.groupId);
          this.scrollToBottom();
        } else {
          const g = this.groups.find((g) => g.id === msg.groupId);
          if (g) {
            g.unreadCount++;
            g.lastMessage = msg;
          }
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.groupMessageSent$.subscribe((msg) => {
        const g = this.groups.find((g) => g.id === msg.groupId);
        if (g) g.lastMessage = msg;
        if (this.selectedGroup && msg.groupId === this.selectedGroup.id) {
          this.groupMessages.push(msg);
          this.syncReversedGroup();
          this.scrollToBottom();
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.groupMessageEdited$.subscribe((msg) => {
        const idx = this.groupMessages.findIndex((m) => m.id === msg.id);
        if (idx >= 0) { this.groupMessages[idx] = msg; this.syncReversedGroup(); }
        const g = this.groups.find((g) => g.id === msg.groupId);
        if (g && g.lastMessage?.id === msg.id) g.lastMessage = msg;
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.groupMessageDeleted$.subscribe(({ messageId, forAll }) => {
        const id = Number(messageId);
        if (forAll) {
          const msg = this.groupMessages.find((m) => m.id === id);
          if (msg) { msg.isDeleted = true; msg.content = ''; msg.fileUrl = null; }
        } else {
          this.groupMessages = this.groupMessages.filter((m) => m.id !== id);
          this.syncReversedGroup();
        }
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.groupMessagePinned$.subscribe(({ messageId, pinned }) => {
        const msg = this.groupMessages.find((m) => m.id === Number(messageId));
        if (msg) msg.isPinned = pinned;
        this.cdr.detectChanges();
      })
    );

    // Mirrors the backend's group:message:seen handling: the member named in
    // `by` has just had every not-yet-read message (from someone else) marked
    // read, so reflect that locally instead of waiting on a refetch.
    this.subs.add(
      this.socketSvc.groupMessageSeen$.subscribe(({ groupId, by }) => {
        if (!this.selectedGroup || groupId !== this.selectedGroup.id) return;
        const byId = Number(by);
        this.groupMessages.forEach((m) => {
          if (m.sender.id !== byId && !m.reads.some((r) => r.userId === byId)) {
            m.reads = [...m.reads, { userId: byId }];
          }
        });
        this.cdr.detectChanges();
      })
    );

    this.subs.add(
      this.socketSvc.groupTyping$.subscribe(({ groupId, isTyping }) => {
        if (!this.selectedGroup || groupId !== this.selectedGroup.id) return;
        this.otherGroupTyping = isTyping;
        clearTimeout(this.groupTypingIndicatorTimeout);
        if (isTyping) {
          this.groupTypingIndicatorTimeout = setTimeout(() => {
            this.otherGroupTyping = false;
            this.cdr.detectChanges();
          }, 4000);
        }
        this.cdr.detectChanges();
      })
    );

    // Call log — push into current conversation and call history
    this.subs.add(
      this.socketSvc.callLogged$.subscribe((msg) => {
        const otherId = this.isMine(msg) ? String(msg.receiver?.id) : String(msg.sender?.id);
        if (this.selected && this.contactId(this.selected) === otherId) {
          this.messages.push(msg);
          this.syncReversed();
          this.scrollToBottom();
        }
        if (this.sidebarTab === 'calls') {
          this.callHistory.unshift(msg);
        }
        this.cdr.detectChanges();
      })
    );
  }

  // ── Calling ───────────────────────────────────────────────────
  // Actual call session lives in CallSessionService (app-wide, survives
  // navigating away from this page) — this page only knows how to trigger one.
  startCall(type: 'audio' | 'video') {
    if (!this.selected || this.callSvc.callState !== 'idle') return;
    this.callSvc.startCall(this.selected.user, type);
  }

  // Group calls go through the Meet Hub Meeting/meeting-room machinery
  // (N-way mesh, already built in Phase 1-2) rather than the 1:1 call:*
  // signaling above, which only ever supports two parties. There's no
  // Notification pipeline for this yet (deferred, same as meeting
  // invites elsewhere), so instead of a silent push, starting a call posts
  // a normal group message with the join link — anyone in the thread, online
  // now or later, can tap it to join.
  groupCallStarting = false;

  startGroupCall(type: 'audio' | 'video') {
    if (!this.selectedGroup || this.callSvc.callState !== 'idle' || this.groupCallStarting) return;
    const group = this.selectedGroup;
    this.groupCallStarting = true;
    this.meetingSvc.create({ groupId: group.id, callType: type, title: group.name }).subscribe({
      next: (res) => {
        this.groupCallStarting = false;
        const meetLink = `${window.location.origin}/meet/${res.meeting.roomCode}`;
        this.socketSvc.sendGroupMessage(group.id, `📞 Started a ${type} call — ${meetLink}`, 'text');
        this.router.navigate(['/meet', res.meeting.roomCode]);
      },
      error: () => {
        this.groupCallStarting = false;
      },
    });
  }

  // ── Utilities ─────────────────────────────────────────────────
  // Matches a bare http(s) URL or a "www."-prefixed domain — the trailing
  // group excludes common sentence-ending punctuation so "check out
  // https://example.com." doesn't swallow the period into the link.
  private static readonly URL_REGEX = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
  private static readonly TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/;

  // Auto-linkifies any URL in a text message so it opens in a new tab —
  // same escape-then-reinsert-safe-HTML approach as project-item-detail's
  // renderBody (mentions), just replacing URLs instead of @mentions. Quotes
  // are escaped too (renderBody doesn't need to, since it never builds an
  // attribute from matched text) — without that, a URL containing a literal
  // `"` (e.g. `https://evil.com/"onmouseover="alert(1)`) could break out of
  // the href="..." attribute built below.
  renderMessageContent(msg: { content: string }): SafeHtml {
    const escapeHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const html = escapeHtml(msg.content).replace(ChatComponent.URL_REGEX, (match) => {
      const trailingMatch = match.match(ChatComponent.TRAILING_PUNCTUATION);
      const trailing = trailingMatch ? trailingMatch[0] : '';
      const url = trailing ? match.slice(0, -trailing.length) : match;
      const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
    });

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

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

  // reversedMsgs is newest-first, so the chronologically-preceding message
  // sits at index + 1; the oldest message (last index) always starts a separator.
  showDateSeparatorReversed(reversedMsgs: { createdAt: string }[], index: number): boolean {
    if (index === reversedMsgs.length - 1) return true;
    const curr = new Date(reversedMsgs[index].createdAt).toDateString();
    const prevInTime = new Date(reversedMsgs[index + 1].createdAt).toDateString();
    return curr !== prevInTime;
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
