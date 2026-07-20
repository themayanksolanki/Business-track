import { Directive, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, Renderer2, SimpleChanges } from '@angular/core';

export interface CardResizeEvent {
  width: number;
  height: number;
}

// Applies a persisted width/height once (imperatively, not via a live
// template binding — a bound [style.width] would fight the browser's own
// resize-drag on every change detection tick) then watches for further
// user-driven resizes via the native CSS `resize` handle and reports the
// final size once it settles, debounced so a drag doesn't fire a save per pixel.
@Directive({
  selector: '[appCardResize]',
  standalone: true,
})
export class CardResizeDirective implements OnChanges, OnDestroy {
  @Input() initialWidth: number | null = null;
  @Input() initialHeight: number | null = null;
  @Output() cardResized = new EventEmitter<CardResizeEvent>();

  private observer?: ResizeObserver;
  private debounceHandle?: ReturnType<typeof setTimeout>;
  private lastSize: CardResizeEvent | null = null;
  private skippedFirst = false;
  private appliedInitial = false;

  constructor(private el: ElementRef<HTMLElement>, private renderer: Renderer2) {}

  ngOnChanges(changes: SimpleChanges) {
    if (this.appliedInitial) return;
    if (!('initialWidth' in changes) && !('initialHeight' in changes)) return;
    this.applyInitialSize();
    this.appliedInitial = true;
    this.startObserving();
  }

  private applyInitialSize() {
    if (this.initialWidth) this.renderer.setStyle(this.el.nativeElement, 'width', `${this.initialWidth}px`);
    if (this.initialHeight) this.renderer.setStyle(this.el.nativeElement, 'height', `${this.initialHeight}px`);
  }

  private startObserving() {
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const size = { width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) };

      // ResizeObserver fires once immediately on observe() with the current
      // (already-applied) size — that's not a user resize, skip reporting it.
      if (!this.skippedFirst) {
        this.skippedFirst = true;
        this.lastSize = size;
        return;
      }
      if (this.lastSize && this.lastSize.width === size.width && this.lastSize.height === size.height) return;
      this.lastSize = size;

      clearTimeout(this.debounceHandle);
      this.debounceHandle = setTimeout(() => this.cardResized.emit(size), 500);
    });
    this.observer.observe(this.el.nativeElement);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    clearTimeout(this.debounceHandle);
  }
}
