import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { RouterLink } from '@angular/router';
import dayjs from 'dayjs/esm';
import { ProjectService } from '../../core/services/project.service';
import { Meeting } from '../../models/meeting.model';

// "Upcoming/past meetings" panel for the Project Detail "Meetings" tab —
// mirrors ProjectTeamsComponent's panel/empty-state/list structure. Actual
// scheduling happens through ProjectDetailComponent's "Schedule meeting"
// action (opens the shared EventDetailDialogComponent pre-scoped to this
// project) — this panel only lists what already exists and re-fetches
// (via reload()) once the parent reports one was scheduled.
@Component({
  selector: 'app-project-meetings',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './project-meetings.component.html',
  styleUrl: './project-meetings.component.css',
})
export class ProjectMeetingsComponent implements OnChanges {
  @Input({ required: true }) projectId!: string;
  @Input() canManage = false;

  @Output() scheduleMeeting = new EventEmitter<void>();

  meetings: Meeting[] = [];
  loading = false;

  constructor(private projectService: ProjectService) {}

  ngOnChanges() {
    this.reload();
  }

  reload() {
    if (!this.projectId) return;
    this.loading = true;
    this.projectService.getMeetings(this.projectId).subscribe({
      next: (meetings) => {
        this.meetings = meetings;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  get upcoming(): Meeting[] {
    return this.meetings
      .filter((m) => m.status === 'scheduled' || m.status === 'live')
      .sort((a, b) => dayjs(a.scheduledStart ?? a.createdAt).diff(dayjs(b.scheduledStart ?? b.createdAt)));
  }

  get past(): Meeting[] {
    return this.meetings
      .filter((m) => m.status === 'ended' || m.status === 'cancelled')
      .sort((a, b) => dayjs(b.scheduledStart ?? b.createdAt).diff(dayjs(a.scheduledStart ?? a.createdAt)));
  }

  timeLabel(meeting: Meeting): string {
    if (!meeting.scheduledStart) return 'No scheduled time';
    const start = dayjs(meeting.scheduledStart);
    return meeting.scheduledEnd
      ? `${start.format('MMM D, YYYY · h:mm A')} – ${dayjs(meeting.scheduledEnd).format('h:mm A')}`
      : start.format('MMM D, YYYY · h:mm A');
  }

  // Same 5-minutes-before-start rule as EventDetailDialogComponent.canJoinMeeting.
  canJoin(meeting: Meeting): boolean {
    if (meeting.status === 'live') return true;
    if (meeting.status !== 'scheduled' || !meeting.scheduledStart) return false;
    return dayjs().isAfter(dayjs(meeting.scheduledStart).subtract(5, 'minute'));
  }
}
