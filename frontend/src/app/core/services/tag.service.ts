import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Tag, CreateTagPayload, UpdateTagPayload } from '../../models/tag.model';

@Injectable({ providedIn: 'root' })
export class TagService {
  private readonly api = `${environment.apiUrl}/tags`;

  constructor(private http: HttpClient) {}

  getTags() {
    return this.http.get<Tag[]>(this.api);
  }

  createTag(payload: CreateTagPayload) {
    return this.http.post<{ message: string; tag: Tag }>(this.api, payload);
  }

  updateTag(id: number, payload: UpdateTagPayload) {
    return this.http.put<{ message: string; tag: Tag }>(`${this.api}/${id}`, payload);
  }

  deleteTag(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
