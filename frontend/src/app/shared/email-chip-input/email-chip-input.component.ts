import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reused for both the Status Report compose "Send To" box and the per-
// project default-recipients manager (project-status-report.component) —
// type-and-commit chips (Enter/comma/blur), each validated as a well-formed
// email, plus a one-click suffix suggestion built from the viewer's own
// organization's emailDomain (e.g. typing "john" suggests "john@acme.com")
// so nobody has to type a full org address by hand.
@Component({
  selector: 'app-email-chip-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './email-chip-input.component.html',
  styleUrl: './email-chip-input.component.css',
})
export class EmailChipInputComponent {
  @Input() value: string[] = [];
  @Output() valueChange = new EventEmitter<string[]>();
  @Input() placeholder = 'Type an email and press Enter…';
  @Input() disabled = false;

  inputText = '';
  error = '';

  constructor(private auth: AuthService) {}

  get suggestion(): string | null {
    const text = this.inputText.trim();
    const domain = this.auth.currentUser()?.organization;
    const emailDomain = domain && typeof domain === 'object' ? domain.emailDomain : null;
    if (!text || text.includes('@') || !emailDomain) return null;
    return `${text}@${emailDomain}`;
  }

  applySuggestion() {
    if (!this.suggestion) return;
    this.inputText = this.suggestion;
    this.commit();
  }

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      if (this.inputText.trim()) {
        event.preventDefault();
        this.commit();
      }
      return;
    }
    // Tab also commits, but must NOT preventDefault — that would trap focus
    // in the field instead of letting Tab move on to the next control like
    // it normally would.
    if (event.key === 'Tab' && this.inputText.trim()) {
      this.commit();
      return;
    }
    // Backspace on an empty box removes the last chip — same "delete
    // backward through what you just typed" convention as a real chip input.
    if (event.key === 'Backspace' && !this.inputText && this.value.length) {
      this.removeAt(this.value.length - 1);
    }
  }

  onBlur() {
    if (this.inputText.trim()) this.commit();
  }

  private commit() {
    const email = this.inputText.trim().toLowerCase();
    this.inputText = '';
    if (!email) return;
    if (!EMAIL_REGEX.test(email)) {
      this.error = `"${email}" is not a valid email address`;
      return;
    }
    this.error = '';
    if (this.value.includes(email)) return;
    this.valueChange.emit([...this.value, email]);
  }

  removeAt(index: number) {
    if (this.disabled) return;
    this.valueChange.emit(this.value.filter((_, i) => i !== index));
  }
}
