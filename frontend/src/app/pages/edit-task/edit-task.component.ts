import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TaskService } from '../../core/services/task.service';

@Component({
  selector: 'app-edit-task',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './edit-task.component.html',
  styleUrl: './edit-task.component.css',
})
export class EditTaskComponent implements OnInit {
  form: FormGroup;
  error = '';
  loading = false;
  taskId = '';

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
      },
      error: (err) => (this.error = err.error?.message || 'Failed to load task'),
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

    this.taskService.updateTask(Number(this.taskId), this.form.value).subscribe({
      next: () => this.router.navigate(['/tasks']),
      error: (err) => {
        this.error = err.error?.message || 'Failed to update task';
        this.loading = false;
      },
    });
  }
}
