import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { debounce, throttle } from 'lodash-es';
import { PaginatedUsers, User } from '../../models/user.model';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-member-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './member-picker.component.html',
  styleUrl: './member-picker.component.css',
})
export class MemberPickerComponent implements OnDestroy {
  // Caller-supplied candidate fetcher — e.g. Project's
  // `(page, limit, search) => projectService.getMemberCandidates(projectId, page, limit, search)`
  // or Metric's equivalent — so this component isn't hard-coupled to one entity type.
  @Input({ required: true }) fetchCandidates!: (page: number, limit: number, search: string) => Observable<PaginatedUsers>;
  @Input() selectedUser: User | null = null;
  @Output() picked = new EventEmitter<User>();

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('panel') panelRef?: ElementRef<HTMLElement>;

  @ViewChild('sentinel') set sentinelEl(el: ElementRef<HTMLElement> | undefined) {
    this.intersectionObserver?.disconnect();
    if (!el || !this.panelRef) return;
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) this.throttledLoadMore();
      },
      { root: this.panelRef.nativeElement, threshold: 0 }
    );
    this.intersectionObserver.observe(el.nativeElement);
  }

  open = false;
  query = '';
  users: User[] = [];
  page = 1;
  hasMore = true;
  loading = false;
  loadingMore = false;
  error = '';

  private intersectionObserver?: IntersectionObserver;

  // Rate-limits scroll-triggered pagination (throttle: at most one request per
  // window even if the sentinel keeps re-intersecting) and search-triggered
  // refetches (debounce: waits for the user to pause typing).
  private readonly throttledLoadMore = throttle(() => this.loadMore(), 400, { leading: true, trailing: false });
  private readonly debouncedSearch = debounce(() => this.resetAndLoad(), 350);

  ngOnDestroy() {
    this.intersectionObserver?.disconnect();
    this.throttledLoadMore.cancel();
    this.debouncedSearch.cancel();
  }

  toggleOpen() {
    if (this.open) {
      this.closeDropdown();
      return;
    }
    this.open = true;
    this.query = '';
    this.error = '';
    setTimeout(() => this.searchInputRef?.nativeElement.focus(), 0);
    this.resetAndLoad();
  }

  closeDropdown() {
    this.open = false;
    this.throttledLoadMore.cancel();
    this.debouncedSearch.cancel();
  }

  onQueryChange() {
    this.debouncedSearch();
  }

  private resetAndLoad() {
    this.users = [];
    this.page = 1;
    this.hasMore = true;
    this.loadMore();
  }

  private loadMore() {
    if (!this.hasMore || this.loadingMore) return;
    this.loadingMore = true;
    this.loading = this.users.length === 0;
    this.error = '';

    this.fetchCandidates(this.page, PAGE_SIZE, this.query.trim()).subscribe({
      next: (res) => {
        this.users = [...this.users, ...res.users];
        this.hasMore = this.page < res.totalPages;
        this.page++;
        this.loadingMore = false;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load users';
        this.loadingMore = false;
        this.loading = false;
      },
    });
  }

  pick(user: User) {
    this.picked.emit(user);
    this.closeDropdown();
  }
}
