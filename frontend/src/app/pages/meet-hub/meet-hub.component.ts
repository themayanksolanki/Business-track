import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MeetingService } from '../../core/services/meeting.service';
import { Meeting } from '../../models/meeting.model';

@Component({
  selector: 'app-meet-hub',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './meet-hub.component.html',
  styleUrl: './meet-hub.component.css',
})
export class MeetHubComponent implements OnInit {
  upcoming: Meeting[] = [];
  upcomingLoading = false;
  joinCode = '';
  creating = false;
  error = '';

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

  meetingLabel(meeting: Meeting): string {
    return meeting.title || `Meeting with ${meeting.host.username}`;
  }
}
