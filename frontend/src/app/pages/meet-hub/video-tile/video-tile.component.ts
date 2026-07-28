import {
  Component, Input, ViewChild, ElementRef, OnChanges, AfterViewInit, SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

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

  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;

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
