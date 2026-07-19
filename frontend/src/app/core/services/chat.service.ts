import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ContactData, Message } from '../../models/message.model';
import { SKIP_LOADER } from '../interceptors/loading.interceptor';

const BASE = environment.apiUrl.replace('/api', '');

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = `${environment.apiUrl}/chat`;

  private readonly _contacts = signal<ContactData[]>([]);
  readonly contacts    = this._contacts.asReadonly();
  readonly totalUnread = signal(0);

  constructor(private http: HttpClient) {}

  private readonly skipLoaderContext = new HttpContext().set(SKIP_LOADER, true);

  prefetch() {
    if (this._contacts().length) return;
    this.http
      .get<ContactData[]>(`${this.api}/contacts`, { context: this.skipLoaderContext })
      .subscribe({
        next: (c) => this._contacts.set(c),
      });
  }

  fetchUnread() {
    this.http
      .get<ContactData[]>(`${this.api}/contacts`, { context: this.skipLoaderContext })
      .subscribe({
        next: (contacts) => {
          this._contacts.set(contacts);
          this.totalUnread.set(contacts.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0));
        },
        error: () => {},
      });
  }

  getContacts() {
    return this.http.get<ContactData[]>(`${this.api}/contacts`).pipe(
      tap((c) => this._contacts.set(c))
    );
  }

  getMessages(userId: string) {
    return this.http.get<Message[]>(`${this.api}/messages/${userId}`);
  }

  getCallHistory() {
    return this.http.get<Message[]>(`${this.api}/calls`);
  }

  getIceServers() {
    return this.http.get<{ iceServers: RTCIceServer[] }>(`${this.api}/ice-servers`);
  }

  uploadImage(file: File) {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ url: string }>(`${this.api}/upload`, form);
  }

  clearChat(userId: string) {
    return this.http.delete<{ success: boolean }>(`${this.api}/clear/${userId}`);
  }

  toggleBlock(userId: string) {
    return this.http.post<{ blocked: boolean }>(`${this.api}/block/${userId}`, {});
  }

  toggleMute(userId: string) {
    return this.http.post<{ muted: boolean }>(`${this.api}/mute/${userId}`, {});
  }

  fileUrl(path: string): string {
    if (path.startsWith('http')) return path; // Cloudinary URL — use as-is
    return `${BASE}${path}`; // legacy relative path
  }
}
