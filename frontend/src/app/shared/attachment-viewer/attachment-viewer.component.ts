import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  HostListener,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Observable } from 'rxjs';
import { Attachment } from '../../models/attachment.model';

type AttachmentKind = 'image' | 'video' | 'pdf' | 'other';
type GestureMode = 'none' | 'swipe' | 'pan' | 'pinch';

interface ViewerEntry {
  status: 'loading' | 'loaded' | 'error';
  url?: string;
  safeUrl?: SafeResourceUrl;
  error?: string;
}

const SWIPE_THRESHOLD_PX = 70;
const MIN_SCALE = 1;
const MAX_SCALE = 4;

@Component({
  selector: 'app-attachment-viewer',
  standalone: true,
  templateUrl: './attachment-viewer.component.html',
  styleUrl: './attachment-viewer.component.css',
})
export class AttachmentViewerComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() attachments: Attachment[] = [];
  @Input() startIndex = 0;
  @Input({ required: true }) loadBlob!: (attachment: Attachment) => Observable<Blob>;

  @Output() closed = new EventEmitter<void>();
  @Output() download = new EventEmitter<Attachment>();

  activeIndex = 0;
  dragDeltaPx = 0;
  gestureMode: GestureMode = 'none';

  imgScale = 1;
  imgTranslateX = 0;
  imgTranslateY = 0;

  readonly entries = new Map<number, ViewerEntry>();

  private pointers = new Map<number, { x: number; y: number }>();
  private swipeStartX = 0;
  private panStart = { x: 0, y: 0 };
  private pinchStartDist = 0;
  private pinchStartScale = 1;
  private pinchStartTranslate = { x: 0, y: 0 };

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.setActive(this.startIndex ?? 0);
    } else if (changes['attachments'] && this.open) {
      if (this.attachments.length === 0) {
        this.close();
        return;
      }
      this.setActive(Math.min(this.activeIndex, this.attachments.length - 1));
    }
  }

  ngOnDestroy() {
    for (const entry of this.entries.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
  }

  get current(): Attachment | null {
    return this.attachments[this.activeIndex] ?? null;
  }

  get trackTransform(): string {
    return `translateX(calc(${-this.activeIndex * 100}% + ${this.dragDeltaPx}px))`;
  }

  get imgTransform(): string {
    return `translate(${this.imgTranslateX}px, ${this.imgTranslateY}px) scale(${this.imgScale})`;
  }

  kindOf(a: Attachment): AttachmentKind {
    if (a.mimeType.startsWith('image/')) return 'image';
    if (a.mimeType.startsWith('video/')) return 'video';
    if (a.mimeType === 'application/pdf') return 'pdf';
    return 'other';
  }

  entryFor(a: Attachment): ViewerEntry | undefined {
    return this.entries.get(a.id);
  }

  isNear(index: number): boolean {
    return index >= this.activeIndex - 1 && index <= this.activeIndex + 1;
  }

  private isActiveImage(): boolean {
    const a = this.current;
    return !!a && this.kindOf(a) === 'image';
  }

  close() {
    this.closed.emit();
  }

  next() {
    this.setActive(this.activeIndex + 1);
  }

  prev() {
    this.setActive(this.activeIndex - 1);
  }

  private setActive(index: number) {
    this.activeIndex = Math.max(0, Math.min(this.attachments.length - 1, index));
    this.resetImageTransform();
    this.dragDeltaPx = 0;
    this.loadEntry(this.activeIndex - 1);
    this.loadEntry(this.activeIndex);
    this.loadEntry(this.activeIndex + 1);
  }

  private resetImageTransform() {
    this.imgScale = 1;
    this.imgTranslateX = 0;
    this.imgTranslateY = 0;
    this.gestureMode = 'none';
    this.pointers.clear();
  }

  private loadEntry(index: number) {
    const a = this.attachments[index];
    if (!a) return;
    if (this.kindOf(a) === 'other') return;

    const existing = this.entries.get(a.id);
    if (existing && existing.status !== 'error') return;

    this.entries.set(a.id, { status: 'loading' });
    this.loadBlob(a).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const entry: ViewerEntry = { status: 'loaded', url };
        if (this.kindOf(a) === 'pdf') {
          entry.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
        }
        this.entries.set(a.id, entry);
      },
      error: () => {
        this.entries.set(a.id, { status: 'error', error: 'Failed to load file' });
      },
    });
  }

  retry(a: Attachment) {
    this.entries.delete(a.id);
    this.loadEntry(this.attachments.indexOf(a));
  }

  onMediaLoadError(a: Attachment) {
    const entry = this.entries.get(a.id);
    if (entry?.url) URL.revokeObjectURL(entry.url);
    this.entries.set(a.id, { status: 'error', error: 'This file could not be displayed.' });
  }

  downloadCurrent() {
    if (this.current) this.download.emit(this.current);
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) this.close();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    if (!this.open) return;
    if (event.key === 'Escape') this.close();
    else if (event.key === 'ArrowLeft') this.prev();
    else if (event.key === 'ArrowRight') this.next();
  }

  private dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  onStagePointerDown(event: PointerEvent) {
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2 && this.isActiveImage()) {
      const pts = [...this.pointers.values()];
      this.gestureMode = 'pinch';
      this.pinchStartDist = this.dist(pts[0], pts[1]);
      this.pinchStartScale = this.imgScale;
      this.pinchStartTranslate = { x: this.imgTranslateX, y: this.imgTranslateY };
    } else if (this.pointers.size === 1) {
      if (this.isActiveImage() && this.imgScale > 1) {
        this.gestureMode = 'pan';
        this.panStart = { x: event.clientX - this.imgTranslateX, y: event.clientY - this.imgTranslateY };
      } else {
        this.gestureMode = 'swipe';
        this.swipeStartX = event.clientX;
        this.dragDeltaPx = 0;
      }
    }
  }

  onStagePointerMove(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.gestureMode === 'pinch' && this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const newDist = this.dist(pts[0], pts[1]);
      const factor = newDist / (this.pinchStartDist || 1);
      this.imgScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.pinchStartScale * factor));
      this.imgTranslateX = this.pinchStartTranslate.x;
      this.imgTranslateY = this.pinchStartTranslate.y;
    } else if (this.gestureMode === 'pan') {
      this.imgTranslateX = event.clientX - this.panStart.x;
      this.imgTranslateY = event.clientY - this.panStart.y;
    } else if (this.gestureMode === 'swipe') {
      this.dragDeltaPx = event.clientX - this.swipeStartX;
    }
  }

  onStagePointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);

    if (this.gestureMode === 'swipe' && this.pointers.size === 0) {
      if (this.dragDeltaPx > SWIPE_THRESHOLD_PX) this.prev();
      else if (this.dragDeltaPx < -SWIPE_THRESHOLD_PX) this.next();
      this.dragDeltaPx = 0;
      this.gestureMode = 'none';
      return;
    }

    if (this.gestureMode === 'pinch' && this.pointers.size < 2) {
      if (this.imgScale <= 1.02) {
        this.imgScale = 1;
        this.imgTranslateX = 0;
        this.imgTranslateY = 0;
      }
      if (this.pointers.size === 1) {
        this.gestureMode = 'pan';
        const [p] = [...this.pointers.values()];
        this.panStart = { x: p.x - this.imgTranslateX, y: p.y - this.imgTranslateY };
      } else {
        this.gestureMode = 'none';
      }
    } else if (this.pointers.size === 0) {
      this.gestureMode = 'none';
    }
  }

  onWheel(event: WheelEvent) {
    if (!this.isActiveImage()) return;
    event.preventDefault();
    const delta = -event.deltaY * 0.0015;
    this.imgScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.imgScale + delta * this.imgScale));
    if (this.imgScale <= 1) {
      this.imgScale = 1;
      this.imgTranslateX = 0;
      this.imgTranslateY = 0;
    }
  }

  onDoubleClick() {
    if (!this.isActiveImage()) return;
    if (this.imgScale > 1) {
      this.imgScale = 1;
      this.imgTranslateX = 0;
      this.imgTranslateY = 0;
    } else {
      this.imgScale = 2;
    }
  }

  fileIcon(mimeType: string): string {
    if (mimeType.includes('zip')) return 'bi-file-earmark-zip';
    if (mimeType.includes('word')) return 'bi-file-earmark-word';
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'bi-file-earmark-spreadsheet';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'bi-file-earmark-slides';
    if (mimeType.startsWith('text/')) return 'bi-file-earmark-text';
    return 'bi-file-earmark';
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
