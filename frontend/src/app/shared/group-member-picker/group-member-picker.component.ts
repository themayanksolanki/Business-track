import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { debounce } from 'lodash-es';
import { GroupService } from '../../core/services/group.service';
import { User } from '../../models/user.model';

// Multi-select, org-scoped member picker for group chat — distinct from
// member-picker.component.ts (single-select, hard-tied to a project) rather
// than generalizing that shared component and risking its existing callers.
@Component({
  selector: 'app-group-member-picker',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './group-member-picker.component.html',
  styleUrl: './group-member-picker.component.css',
})
export class GroupMemberPickerComponent implements OnChanges, OnDestroy {
  // null => org-wide search (create-group flow, no group exists yet)
  @Input() groupId: number | null = null;
  @Input() selected: User[] = [];
  @Output() selectedChange = new EventEmitter<User[]>();

  query = '';
  results: User[] = [];
  loading = false;
  error = '';

  private readonly debouncedSearch = debounce(() => this.search(), 350);

  constructor(private groupService: GroupService) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['groupId']) this.search();
  }

  ngOnDestroy() {
    this.debouncedSearch.cancel();
  }

  onQueryChange() {
    this.debouncedSearch();
  }

  private search() {
    this.loading = true;
    this.error = '';
    this.groupService.getMemberCandidates(this.groupId, 1, 20, this.query.trim()).subscribe({
      next: (res) => {
        this.results = res.users;
        this.loading = false;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load users';
        this.loading = false;
      },
    });
  }

  isSelected(user: User): boolean {
    return this.selected.some((u) => u.id === user.id);
  }

  toggle(user: User) {
    if (this.isSelected(user)) this.selectedChange.emit(this.selected.filter((u) => u.id !== user.id));
    else this.selectedChange.emit([...this.selected, user]);
  }

  remove(user: User) {
    this.selectedChange.emit(this.selected.filter((u) => u.id !== user.id));
  }
}
