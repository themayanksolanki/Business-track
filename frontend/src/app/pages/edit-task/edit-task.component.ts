import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import dayjs from 'dayjs/esm';
import { TaskService } from '../../core/services/task.service';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';

@Component({
  selector: 'app-edit-task',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePickerComponent],
  templateUrl: './edit-task.component.html',
  styleUrl: './edit-task.component.css',
})
export class EditTaskComponent implements OnInit {
  form: FormGroup;
  error = '';
  loading = false;
  // Set only when the initial load fails (task deleted/inaccessible) — kept
  // separate from `error` (also used for a failed save) so a later submit
  // failure doesn't hide the form the user is actively editing.
  notFound = false;
  taskId = '';
  startDate: string | null = null;
  dueDate: string | null = null;

  constructor(
    private fb: FormBuilder,
    private taskService: TaskService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.form = this.fb.group({
      title: ['', Validators.required],
      description: [''],
      status: ['pending', Validators.required],
    });
  }

  ngOnInit() {
    this.taskId = this.route.snapshot.paramMap.get('id')!;
    this.taskService.getTaskById(Number(this.taskId)).subscribe({
      next: (task) => {
        this.form.patchValue({
          title: task.title,
          description: task.description,
          status: task.status,
        });
        this.startDate = task.startDate ? dayjs(task.startDate).format('YYYY-MM-DD') : null;
        this.dueDate = task.dueDate ? dayjs(task.dueDate).format('YYYY-MM-DD') : null;
      },
      error: (err) => {
        this.error = err.error?.message || 'Failed to load task';
        this.notFound = true;
      },
    });
  }

  get selectedStatusLabel() {
    return this.form.get('status')?.value === 'completed' ? 'Completed' : 'Pending';
  }

  selectStatus(status: string) {
    this.form.get('status')?.setValue(status);
  }

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    this.error = '';

    const payload = {
      ...this.form.value,
      startDate: this.startDate ? dayjs(this.startDate, 'YYYY-MM-DD').toISOString() : null,
      dueDate: this.dueDate ? dayjs(this.dueDate, 'YYYY-MM-DD').toISOString() : null,
    };

    this.taskService.updateTask(Number(this.taskId), payload).subscribe({
      next: () => this.router.navigate(['/tasks']),
      error: (err) => {
        this.error = err.error?.message || 'Failed to update task';
        this.loading = false;
      },
    });
  }
}
