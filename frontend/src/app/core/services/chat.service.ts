import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ContactData, Message } from '../../models/message.model';

const BASE = environment.apiUrl.replace('/api', '');

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = `${environment.apiUrl}/chat`;

  private readonly _contacts = signal<ContactData[]>([]);
  readonly contacts = this._contacts.asReadonly();

  constructor(private http: HttpClient) {}

  prefetch() {
    if (this._contacts().length) return;
    this.http.get<ContactData[]>(`${this.api}/contacts`).subscribe({
      next: (c) => this._contacts.set(c),
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

  uploadImage(file: File) {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ url: string }>(`${this.api}/upload`, form);
  }

  fileUrl(path: string): string {
    if (path.startsWith('http')) return path; // Cloudinary URL — use as-is
    return `${BASE}${path}`; // legacy relative path
  }
}
