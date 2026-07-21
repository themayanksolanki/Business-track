import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Tag, CreateTagPayload, UpdateTagPayload } from '../../models/tag.model';

@Injectable({ providedIn: 'root' })
export class TagService {
  private readonly api = `${environment.apiUrl}/tags`;

  // Org-wide tag list — see DepartmentService.departments for the same
  // lazy-load-once-per-session cache pattern. createTag() below also keeps
  // this in sync, so a tag created from any picker shows up everywhere else
  // immediately without a refetch.
  private readonly _tags = signal<Tag[]>([]);
  readonly tags = this._tags.asReadonly();
  private loaded = false;

  constructor(private http: HttpClient) {}

  getTags() {
    return this.http.get<Tag[]>(this.api);
  }

  ensureTagsLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    this.getTags().subscribe({
      next: (tags) => this._tags.set(tags),
      error: () => (this.loaded = false),
    });
  }

  // Forces a fresh fetch and updates the shared cache — call after any
  // mutation (update/delete) so every other consumer reading `tags` picks
  // up the change without a full page reload.
  refreshTags() {
    return this.getTags().pipe(
      tap((tags) => {
        this._tags.set(tags);
        this.loaded = true;
      })
    );
  }

  createTag(payload: CreateTagPayload) {
    return this.http.post<{ message: string; tag: Tag }>(this.api, payload).pipe(
      tap((res) => this._tags.set([...this._tags(), res.tag]))
    );
  }

  updateTag(id: number, payload: UpdateTagPayload) {
    return this.http.put<{ message: string; tag: Tag }>(`${this.api}/${id}`, payload);
  }

  deleteTag(id: number) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }
}
