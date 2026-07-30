import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import dayjs from 'dayjs/esm';
import { MeetingService } from '../../core/services/meeting.service';
import { Meeting } from '../../models/meeting.model';
import { DatePickerComponent } from '../../shared/date-picker/date-picker.component';
import { TimePickerComponent } from '../../shared/time-picker/time-picker.component';

@Component({
  selector: 'app-meet-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent, TimePickerComponent],
  templateUrl: './meet-hub.component.html',
  styleUrl: './meet-hub.component.css',
})
export class MeetHubComponent implements OnInit {
  upcoming: Meeting[] = [];
  upcomingLoading = false;
  joinCode = '';
  creating = false;
  error = '';

  // ── Schedule for later ──────────────────────────────────────────
  scheduling = false;
  scheduleTitle = '';
  scheduleDate: string | null = null;
  scheduleStartTime: string | null = null;
  scheduleEndTime: string | null = null;
  scheduleSaving = false;
  scheduleError = '';

  constructor(
    private meetingSvc: MeetingService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.loadUpcoming();
  }

  loadUpcoming() {
    this.upcomingLoading = true;
    this.meetingSvc.getUpcoming().subscribe({
      next: (meetings) => { this.upcoming = meetings; this.upcomingLoading = false; },
      error: () => { this.upcomingLoading = false; },
    });
  }

  startNewMeeting() {
    if (this.creating) return;
    this.creating = true;
    this.error = '';
    this.meetingSvc.create({}).subscribe({
      next: ({ meeting }) => this.router.navigate(['/meet', meeting.roomCode]),
      error: () => {
        this.creating = false;
        this.error = 'Could not create a meeting. Please try again.';
      },
    });
  }

  joinWithCode() {
    const code = this.joinCode.trim();
    if (!code) return;
    this.router.navigate(['/meet', code]);
  }

  openMeeting(meeting: Meeting) {
    this.router.navigate(['/meet', meeting.roomCode]);
  }

  toggleScheduling() {
    this.scheduling = !this.scheduling;
    if (this.scheduling) {
      const start = dayjs().add(1, 'hour').startOf('hour');
      this.scheduleTitle = '';
      this.scheduleDate = start.format('YYYY-MM-DD');
      this.scheduleStartTime = start.format('HH:mm');
      this.scheduleEndTime = start.add(1, 'hour').format('HH:mm');
      this.scheduleError = '';
    }
  }

  clampScheduleEndToStart() {
    if (!this.scheduleDate) return;
    const start = this.combineScheduleDateTime(this.scheduleStartTime);
    const end = this.combineScheduleDateTime(this.scheduleEndTime);
    if (dayjs(start).isAfter(end)) this.scheduleEndTime = this.scheduleStartTime;
  }

  private combineScheduleDateTime(time: string | null): string {
    return dayjs(`${this.scheduleDate} ${time || '00:00'}`, 'YYYY-MM-DD HH:mm').toISOString();
  }

  scheduleMeeting() {
    if (!this.scheduleDate) {
      this.scheduleError = 'Pick a date';
      return;
    }
    const start = this.combineScheduleDateTime(this.scheduleStartTime);
    const end = this.combineScheduleDateTime(this.scheduleEndTime);
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      this.scheduleError = 'End time must be after the start time';
      return;
    }

    this.scheduleSaving = true;
    this.scheduleError = '';
    this.meetingSvc.create({ title: this.scheduleTitle.trim() || undefined, scheduledStart: start, scheduledEnd: end }).subscribe({
      next: () => {
        this.scheduleSaving = false;
        this.scheduling = false;
        this.loadUpcoming();
      },
      error: (err) => {
        this.scheduleSaving = false;
        this.scheduleError = err.error?.message || 'Could not schedule the meeting.';
      },
    });
  }

  meetingLabel(meeting: Meeting): string {
    return meeting.title || `Meeting with ${meeting.host.username}`;
  }
}
