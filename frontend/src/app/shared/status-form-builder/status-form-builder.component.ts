import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { ModalDirective } from '../modal.directive';
import { StatusFormQuestionType, StatusForm, StatusFormQuestion, CreateStatusFormPayload, UpdateStatusFormPayload } from '../../models/status-form.model';

export type StatusFormBuilderMode = 'create' | 'edit';

interface QuestionTypeOption {
  value: StatusFormQuestionType;
  label: string;
  icon: string;
}

// Palette on the left — order here is also the order they appear in the list.
const QUESTION_TYPE_OPTIONS: QuestionTypeOption[] = [
  { value: 'shortText', label: 'Short Text', icon: 'bi-input-cursor-text' },
  { value: 'longText', label: 'Long Text', icon: 'bi-text-paragraph' },
  { value: 'richText', label: 'Rich Text', icon: 'bi-file-richtext' },
  { value: 'singleSelect', label: 'Single Select', icon: 'bi-ui-radios' },
  { value: 'multiSelect', label: 'Multi Select', icon: 'bi-ui-checks' },
  { value: 'attachment', label: 'Attachment', icon: 'bi-paperclip' },
];

const QUESTION_TYPE_LABELS = Object.fromEntries(QUESTION_TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<StatusFormQuestionType, string>;
const QUESTION_TYPE_ICONS = Object.fromEntries(QUESTION_TYPE_OPTIONS.map((o) => [o.value, o.icon])) as Record<StatusFormQuestionType, string>;

// Question types whose "options" FormArray is actually used/validated —
// every other type keeps an empty options array (still present in the group
// so submit()'s payload mapping doesn't need a type-conditional shape check).
const OPTION_TYPES: StatusFormQuestionType[] = ['singleSelect', 'multiSelect'];

@Component({
  selector: 'app-status-form-builder',
  standalone: true,
  imports: [ReactiveFormsModule, DragDropModule, ModalDirective],
  templateUrl: './status-form-builder.component.html',
  styleUrl: './status-form-builder.component.css',
})
export class StatusFormBuilderComponent implements OnChanges {
  @Input() open = false;
  @Input() mode: StatusFormBuilderMode = 'create';
  @Input() initial: StatusForm | null = null;
  @Input() loading = false;
  @Input() error = '';

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CreateStatusFormPayload | UpdateStatusFormPayload>();

  readonly questionTypeOptions = QUESTION_TYPE_OPTIONS;
  readonly typeLabels = QUESTION_TYPE_LABELS;
  readonly typeIcons = QUESTION_TYPE_ICONS;

  localError = '';
  form: FormGroup;

  get displayError(): string {
    return this.localError || this.error;
  }

  get questionsArray(): FormArray<FormGroup> {
    return this.form.get('questions') as FormArray<FormGroup>;
  }

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      title: [''],
      description: [''],
      questions: this.fb.array<FormGroup>([]),
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.form.reset({ title: this.initial?.title ?? '', description: this.initial?.description ?? '' });
      this.questionsArray.clear();
      (this.initial?.questions ?? []).forEach((q) => this.questionsArray.push(this.createQuestionGroup(q.type, q)));
      this.localError = '';
    }
  }

  private createQuestionGroup(type: StatusFormQuestionType, seed?: Pick<StatusFormQuestion, 'label' | 'required' | 'options'>): FormGroup {
    const seedOptions = seed?.options?.length ? seed.options : OPTION_TYPES.includes(type) ? ['', ''] : [];
    return this.fb.group({
      type: [type],
      label: [seed?.label ?? ''],
      required: [seed?.required ?? false],
      options: this.fb.array(seedOptions.map((o) => this.fb.control(o))),
    });
  }

  optionsArray(index: number): FormArray<FormControl<string | null>> {
    return this.questionsArray.at(index).get('options') as FormArray<FormControl<string | null>>;
  }

  // Explicit return type here (rather than reading `q.value.type` straight
  // in the template) is what lets `typeIcons[...]`/`typeLabels[...]` resolve
  // to a real key instead of an implicit `any` under strictTemplates.
  typeAt(index: number): StatusFormQuestionType {
    return this.questionsArray.at(index).get('type')!.value;
  }

  hasOptions(index: number): boolean {
    return OPTION_TYPES.includes(this.typeAt(index));
  }

  addQuestion(type: StatusFormQuestionType) {
    this.questionsArray.push(this.createQuestionGroup(type));
  }

  removeQuestion(index: number) {
    this.questionsArray.removeAt(index);
  }

  addOption(index: number) {
    this.optionsArray(index).push(this.fb.control(''));
  }

  removeOption(index: number, optionIndex: number) {
    this.optionsArray(index).removeAt(optionIndex);
  }

  // Angular's FormArray has no built-in "move" operation — moveItemInArray
  // splices `.controls` (the same array `push`/`removeAt` mutate internally)
  // in place, and updateValueAndValidity() recomputes `.value` from the new
  // order so the submitted payload reflects the drag.
  onDrop(event: CdkDragDrop<FormGroup[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.questionsArray.controls, event.previousIndex, event.currentIndex);
    this.questionsArray.updateValueAndValidity();
  }

  // Same reordering idiom as onDrop, scoped to one question's own options list.
  onOptionDrop(questionIndex: number, event: CdkDragDrop<FormControl<string | null>[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const options = this.optionsArray(questionIndex);
    moveItemInArray(options.controls, event.previousIndex, event.currentIndex);
    options.updateValueAndValidity();
  }

  submit() {
    this.localError = '';
    const { title, description, questions } = this.form.getRawValue();

    if (!title || !title.trim()) {
      this.localError = 'Title is required';
      return;
    }
    if (!questions.length) {
      this.localError = 'Add at least one question from the Elements panel';
      return;
    }
    for (const q of questions) {
      if (!q.label || !q.label.trim()) {
        this.localError = 'Every question needs a label';
        return;
      }
      if (OPTION_TYPES.includes(q.type)) {
        const validOptions = (q.options as string[]).filter((o) => o && o.trim());
        if (validOptions.length < 2) {
          this.localError = `"${q.label}" needs at least 2 options`;
          return;
        }
      }
    }

    this.submitted.emit({
      title: title.trim(),
      description: description?.trim() || '',
      questions: questions.map((q: { type: StatusFormQuestionType; label: string; required: boolean; options: string[] }) => ({
        type: q.type,
        label: q.label.trim(),
        required: !!q.required,
        options: OPTION_TYPES.includes(q.type) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
      })),
    });
  }
}
