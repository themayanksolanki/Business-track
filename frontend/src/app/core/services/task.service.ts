import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Task, CreateTaskPayload, UpdateTaskPayload } from '../../models/task.model';

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly api = `${environment.apiUrl}/tasks`;

  constructor(private http: HttpClient) {}

  getTasks() {
    return this.http.get<Task[]>(this.api);
  }

  getTaskById(id: string) {
    return this.http.get<Task>(`${this.api}/${id}`);
  }

  createTask(payload: CreateTaskPayload) {
    return this.http.post<{ message: string; task: Task }>(this.api, payload);
  }

  updateTask(id: string, payload: UpdateTaskPayload) {
    return this.http.put<{ message: string; task: Task }>(`${this.api}/${id}`, payload);
  }

  deleteTask(id: string) {
    return this.http.delete<{ message: string }>(`${this.api}/${id}`);
  }

  reassignTask(id: string, assignedTo: string) {
    return this.http.patch<{ message: string; task: Task }>(`${this.api}/${id}/reassign`, { assignedTo });
  }

  getSubtasks(id: string) {
    return this.http.get<Task[]>(`${this.api}/${id}/subtasks`);
  }
}
