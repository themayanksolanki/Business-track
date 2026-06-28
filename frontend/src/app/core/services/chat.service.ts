import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ContactData, Message } from '../../models/message.model';

const BASE = environment.apiUrl.replace('/api', '');

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = `${environment.apiUrl}/chat`;

  constructor(private http: HttpClient) {}

  getContacts() {
    return this.http.get<ContactData[]>(`${this.api}/contacts`);
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
    return `${BASE}${path}`;
  }
}
