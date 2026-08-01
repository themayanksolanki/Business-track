import {
  Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnChanges, AfterViewInit, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { MeetingUser } from '../../../models/meeting.model';
import { CallIconComponent } from '../../../shared/call-icon/call-icon.component';

@Component({
  selector: 'app-video-tile',
  standalone: true,
  imports: [CommonModule, CallIconComponent],
  templateUrl: './video-tile.component.html',
  styleUrl: './video-tile.component.css',
})
export class VideoTileComponent implements OnChanges, AfterViewInit {
  @Input() stream: MediaStream | null = null;
  @Input() label = '';
  @Input() muted = false;
  @Input() camOff = false;
  // Flips the feed horizontally — only ever set for a user's OWN camera
  // preview (a "mirror" is what people expect looking at themselves, the
  // same way any camera app behaves), never for a remote participant's
  // tile or an actual screen-share, which must stay unflipped/readable.
  @Input() mirror = false;
  // Shown (avatar or initial) in place of the generic camera-off icon when
  // known — falls back to the icon for tiles this data isn't wired up for.
  @Input() user: MeetingUser | null = null;
  @Input() handRaised = false;
  @Input() isScreenSharing = false;
  // True when this tile's owner is on a mobile device (see
  // shared/utils/device.util.ts) — letterboxes the video instead of the
  // default edge-to-edge crop, since a phone's camera capture is often
  // portrait-shaped and object-fit: cover would otherwise crop into
  // whatever padding the browser adds to fill the requested landscape frame.
  @Input() isMobileDevice = false;
  // Host-only — the local tile never shows this (you can't kick yourself).
  @Input() showKick = false;
  @Output() kick = new EventEmitter<void>();

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
