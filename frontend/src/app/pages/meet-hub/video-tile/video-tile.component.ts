import {
  Component, Input, ViewChild, ElementRef, OnChanges, AfterViewInit, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { MeetingUser } from '../../../models/meeting.model';

@Component({
  selector: 'app-video-tile',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './video-tile.component.html',
  styleUrl: './video-tile.component.css',
})
export class VideoTileComponent implements OnChanges, AfterViewInit {
  @Input() stream: MediaStream | null = null;
  @Input() label = '';
  @Input() muted = false;
  @Input() camOff = false;
  // Shown (avatar or initial) in place of the generic camera-off icon when
  // known — falls back to the icon for tiles this data isn't wired up for.
  @Input() user: MeetingUser | null = null;

  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;

  constructor(private auth: AuthService) {}

  get avatarUrl(): string | null {
    return this.user ? this.auth.avatarUrl(this.user) : null;
  }

  ngAfterViewInit() {
    this.attach();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['stream']) this.attach();
  }

  private attach() {
    const video = this.videoRef?.nativeElement;
    if (video && this.stream && video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => {});
    }
  }
}
