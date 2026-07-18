import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Tag, TagLite } from '../../models/tag.model';
import { TagService } from '../../core/services/tag.service';
import { TagPillComponent } from '../tag-pill/tag-pill.component';

@Component({
  selector: 'app-tag-picker',
  standalone: true,
  imports: [FormsModule, TagPillComponent],
  templateUrl: './tag-picker.component.html',
  styleUrl: './tag-picker.component.css',
})
export class TagPickerComponent {
  @Input() allTags: Tag[] = [];
  @Input() selectedTags: TagLite[] = [];
  @Input() canCreate = true;

  @Output() tagsChange = new EventEmitter<TagLite[]>();
  @Output() tagCreated = new EventEmitter<Tag>();

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  open = false;
  query = '';
  highlightedIndex = 0;
  creating = false;
  createError = '';

  constructor(private tagService: TagService) {}

  get filteredTags(): Tag[] {
    const q = this.query.trim().toLowerCase();
    const selectedIds = new Set(this.selectedTags.map((t) => t.id));
    return this.allTags.filter((t) => !selectedIds.has(t.id) && (!q || t.name.toLowerCase().includes(q)));
  }

  get canShowCreateRow(): boolean {
    const q = this.query.trim();
    if (!q || !this.canCreate) return false;
    return !this.allTags.some((t) => t.name.toLowerCase() === q.toLowerCase());
  }

  toggleOpen() {
    if (this.open) {
      this.closeDropdown();
      return;
    }
    this.open = true;
    this.query = '';
    this.highlightedIndex = 0;
    this.createError = '';
    setTimeout(() => this.searchInputRef?.nativeElement.focus(), 0);
  }

  closeDropdown() {
    this.open = false;
    this.query = '';
    this.highlightedIndex = 0;
    this.createError = '';
  }

  onQueryChange() {
    this.highlightedIndex = 0;
  }

  selectTag(tag: Tag) {
    if (this.selectedTags.some((t) => t.id === tag.id)) return;
    this.tagsChange.emit([...this.selectedTags, tag]);
    this.query = '';
    this.highlightedIndex = 0;
    this.searchInputRef?.nativeElement.focus();
  }

  removeTag(tag: TagLite) {
    this.tagsChange.emit(this.selectedTags.filter((t) => t.id !== tag.id));
  }

  createTag() {
    if (!this.canShowCreateRow || this.creating) return;
    const name = this.query.trim();
    this.creating = true;
    this.createError = '';
    this.tagService
      .createTag({ name, textColor: '#1f2937', backgroundColor: '#e5e7eb' })
      .subscribe({
        next: (res) => {
          this.creating = false;
          this.tagCreated.emit(res.tag);
          this.tagsChange.emit([...this.selectedTags, res.tag]);
          this.query = '';
          this.highlightedIndex = 0;
          this.searchInputRef?.nativeElement.focus();
        },
        error: (err) => {
          this.creating = false;
          this.createError = err.error?.message || 'Failed to create tag';
        },
      });
  }

  onKeydown(event: KeyboardEvent) {
    const total = this.filteredTags.length + (this.canShowCreateRow ? 1 : 0);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (total > 0) this.highlightedIndex = (this.highlightedIndex + 1) % total;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (total > 0) this.highlightedIndex = (this.highlightedIndex - 1 + total) % total;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.highlightedIndex < this.filteredTags.length) {
        const tag = this.filteredTags[this.highlightedIndex];
        if (tag) this.selectTag(tag);
      } else if (this.canShowCreateRow) {
        this.createTag();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeDropdown();
    }
  }
}
