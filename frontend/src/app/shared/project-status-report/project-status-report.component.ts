import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import dayjs from 'dayjs/esm';
import { AuthService } from '../../core/services/auth.service';
import { StatusFormService } from '../../core/services/status-form.service';
import { StatusReportService } from '../../core/services/status-report.service';
import { NotificationService } from '../notification.service';
import { Project } from '../../models/project.model';
import { StatusForm, StatusFormQuestion, StatusFormSubmission, StatusReportAnswer } from '../../models/status-form.model';
import { EmailChipInputComponent } from '../email-chip-input/email-chip-input.component';

type AnswerValue = string | string[] | null;

// Note deliberately punted for now, same "keep the dynamic renderer complete
// without new storage plumbing" reasoning documented on the 'attachment'
// branch below: 'richText' renders as a plain textarea rather than a second
// CKEditor instance per question — wiring N dynamic rich-text editors inside
// one @for loop is a bigger, separate piece of work.
interface PreviewData {
  mode: 'save' | 'send' | 'view';
  subject: string;
  formTitle: string;
  reportDate: string;
  preparedByName: string;
  preparedByEmail: string;
  recipients: string[];
  answers: StatusReportAnswer[];
}

@Component({
  selector: 'app-project-status-report',
  standalone: true,
  imports: [CommonModule, FormsModule, EmailChipInputComponent],
  templateUrl: './project-status-report.component.html',
  styleUrl: './project-status-report.component.css',
})
export class ProjectStatusReportComponent implements OnInit, OnChanges {
  // Route param, passed through as a string — same convention as
  // ProjectMeetingsComponent/ProjectTeamsComponent's own projectId @Input.
  @Input({ required: true }) projectId!: string;
  @Input({ required: true }) project!: Project;
  // Parent (ProjectDetailComponent) owns the canonical `project` object —
  // this only ever patches the two fields this tab can change, mirroring
  // MetricBowlingComponent's onMetricMembersChanged-style partial patch.
  @Output() projectPatched = new EventEmitter<Partial<Project>>();

  activeForm: StatusForm | null = null;
  answers: Record<number, AnswerValue> = {};
  subject = '';
  reportDate = dayjs().format('YYYY-MM-DD');
  recipients: string[] = [];

  defaultRecipients: string[] = [];
  showDefaultRecipients = false;
  savingDefaults = false;

  submissions: StatusFormSubmission[] = [];
  submissionsLoading = false;

  templateChangeLoading = false;
  saving = false;
  formError = '';

  preview: PreviewData | null = null;
  previewMode: 'save' | 'send' | 'view' = 'save';

  constructor(
    public auth: AuthService,
    public statusFormSvc: StatusFormService,
    private statusReportSvc: StatusReportService,
    private notifications: NotificationService
  ) {}

  ngOnInit() {
    this.statusFormSvc.ensureStatusFormsLoaded();
    this.activeForm = this.project.activeStatusForm;
    this.defaultRecipients = [...this.project.statusReportRecipients];
    this.resetComposeForm();
    this.loadSubmissions();
  }

  // Angular reuses this component instance across a same-route project
  // switch (e.g. navigating between two projects without leaving Project
  // Detail) — projectId changing after the first bind means "different
  // project", so everything below is reloaded from scratch rather than left
  // stale from whichever project was open before.
  ngOnChanges(changes: SimpleChanges) {
    if (changes['projectId'] && !changes['projectId'].firstChange) {
      this.activeForm = this.project.activeStatusForm;
      this.defaultRecipients = [...this.project.statusReportRecipients];
      this.resetComposeForm();
      this.loadSubmissions();
    }
  }

  get canManage(): boolean {
    const user = this.auth.currentUser();
    if (!user) return false;
    if (user.role === 'Admin') return true;
    return this.project.owner?.id === user.id;
  }

  private loadSubmissions() {
    this.submissionsLoading = true;
    this.statusReportSvc.getSubmissions(this.projectId).subscribe({
      next: (subs) => {
        this.submissions = subs;
        this.submissionsLoading = false;
      },
      error: () => {
        this.submissionsLoading = false;
      },
    });
  }

  // ── Template selection ──────────────────────────────────────────
  onSelectTemplate(formId: number | null) {
    if (!this.canManage || this.templateChangeLoading) return;
    if (formId === (this.activeForm?.id ?? null)) return;
    this.templateChangeLoading = true;
    this.statusReportSvc.selectTemplate(this.projectId, formId).subscribe({
      next: (res) => {
        this.activeForm = res.activeStatusForm;
        this.templateChangeLoading = false;
        this.projectPatched.emit({ activeStatusFormId: res.activeStatusFormId, activeStatusForm: res.activeStatusForm });
        this.resetComposeForm();
      },
      error: (err) => {
        this.templateChangeLoading = false;
        this.notifications.error(err.error?.message || 'Failed to select template');
      },
    });
  }

  // ── Compose form ─────────────────────────────────────────────────
  private defaultValueFor(q: StatusFormQuestion): AnswerValue {
    return q.type === 'multiSelect' ? [] : null;
  }

  // Also the "Clear" button's handler — same reset either way (a fresh,
  // blank report ready to compose), just also called after selecting a new
  // template and right after Save/Save-and-Send commits the current one.
  resetComposeForm() {
    this.formError = '';
    this.answers = {};
    (this.activeForm?.questions ?? []).forEach((q) => {
      this.answers[q.id!] = this.defaultValueFor(q);
    });
    this.subject = this.defaultSubject();
    this.reportDate = dayjs().format('YYYY-MM-DD');
    // Auto-fills from the project's default list — see saveDefaultRecipients
    // below for how that list itself gets set.
    this.recipients = [...this.defaultRecipients];
  }

  clearForm() {
    this.resetComposeForm();
  }

  private defaultSubject(): string {
    if (!this.activeForm) return '';
    return `${this.project.name} Status Report — ${dayjs().format('MMM D, YYYY')}`;
  }

  updateAnswer(questionId: number, value: AnswerValue) {
    this.answers[questionId] = value;
  }

  toggleMultiSelectOption(questionId: number, option: string) {
    const current = (this.answers[questionId] as string[]) ?? [];
    this.answers[questionId] = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
  }

  isMultiSelectChecked(questionId: number, option: string): boolean {
    return ((this.answers[questionId] as string[]) ?? []).includes(option);
  }

  get preparedByName(): string {
    return this.auth.currentUser()?.username ?? '';
  }

  get preparedByEmail(): string {
    return this.auth.currentUser()?.email ?? '';
  }

  private buildAnswers(): StatusReportAnswer[] {
    return (this.activeForm?.questions ?? []).map((q) => ({
      questionId: q.id!,
      label: q.label,
      type: q.type,
      value: this.answers[q.id!] ?? null,
    }));
  }

  private validateRequired(): boolean {
    const missing = (this.activeForm?.questions ?? []).find((q) => {
      if (!q.required) return false;
      const v = this.answers[q.id!];
      return v == null || v === '' || (Array.isArray(v) && v.length === 0);
    });
    if (missing) {
      this.formError = `"${missing.label}" is required`;
      return false;
    }
    this.formError = '';
    return true;
  }

  // ── Preview / Save / Send ───────────────────────────────────────
  // Both Save and Save-and-Send open this SAME preview first — the confirm
  // button inside it is what actually calls the backend (see
  // confirmPreview) — rather than either button submitting directly.
  openPreview(mode: 'save' | 'send') {
    if (!this.activeForm || !this.canManage) return;
    if (!this.validateRequired()) return;
    if (mode === 'send' && this.recipients.length === 0) {
      this.formError = 'Add at least one recipient before sending';
      return;
    }
    this.previewMode = mode;
    this.preview = {
      mode,
      subject: this.subject.trim() || this.defaultSubject(),
      formTitle: this.activeForm.title,
      reportDate: this.reportDate,
      preparedByName: this.preparedByName,
      preparedByEmail: this.preparedByEmail,
      recipients: [...this.recipients],
      answers: this.buildAnswers(),
    };
  }

  // Read-only variant for a past history entry — same modal, no Confirm
  // button (see the template's @if on previewMode === 'view').
  viewSubmission(sub: StatusFormSubmission) {
    this.previewMode = 'view';
    this.preview = {
      mode: 'view',
      subject: sub.subject,
      formTitle: sub.formTitle,
      reportDate: dayjs(sub.submittedAt).format('YYYY-MM-DD'),
      preparedByName: sub.submittedBy.username,
      preparedByEmail: sub.submittedBy.email,
      recipients: sub.recipients,
      answers: sub.answers,
    };
  }

  closePreview() {
    this.preview = null;
  }

  confirmPreview() {
    if (!this.preview || this.previewMode === 'view' || !this.activeForm || this.saving) return;
    this.saving = true;
    const send = this.previewMode === 'send';
    this.statusReportSvc
      .createSubmission(this.projectId, {
        statusFormId: this.activeForm.id,
        subject: this.preview.subject,
        answers: this.preview.answers,
        send,
        recipients: send ? this.preview.recipients : undefined,
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.submissions = [res.submission, ...this.submissions];
          this.preview = null;
          if (res.emailError) this.notifications.error(res.emailError);
          else this.notifications.success(send ? 'Status report saved and sent' : 'Status report saved');
          // Every Save/Save-and-Send is its own permanent history entry —
          // the compose form stays exactly as filled, ready to tweak and
          // Save again as another entry, or Clear to start a fresh one.
        },
        error: (err) => {
          this.saving = false;
          this.notifications.error(err.error?.message || 'Failed to save status report');
        },
      });
  }

  // ── Default recipients ───────────────────────────────────────────
  saveDefaultRecipients() {
    if (!this.canManage || this.savingDefaults) return;
    this.savingDefaults = true;
    this.statusReportSvc.updateRecipients(this.projectId, this.defaultRecipients).subscribe({
      next: (res) => {
        this.savingDefaults = false;
        this.projectPatched.emit({ statusReportRecipients: res.statusReportRecipients });
        this.notifications.success('Default recipients updated');
      },
      error: (err) => {
        this.savingDefaults = false;
        this.notifications.error(err.error?.message || 'Failed to update default recipients');
      },
    });
  }

  formatSubmittedAt(iso: string): string {
    return dayjs(iso).format('MMM D, YYYY h:mm A');
  }

  // ── Preview modal answer rendering (also used read-only for a past
  // history entry via viewSubmission) ─────────────────────────────
  answerIsEmpty(a: StatusReportAnswer): boolean {
    return a.value == null || a.value === '' || (Array.isArray(a.value) && a.value.length === 0);
  }

  answerDisplayValue(a: StatusReportAnswer): string {
    if (this.answerIsEmpty(a)) return '—';
    return Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
  }
}
