import { Directive, ElementRef, HostListener, AfterViewInit, Input, OnChanges, OnDestroy } from '@angular/core';

// Resizes a textarea to fit its content, with no drag handle and no scrollbar —
// bound to a value input (not just the native `input` event) so programmatic
// changes (e.g. reactive-form patchValue while the element stays mounted) also
// trigger a re-measure, not just user keystrokes.
@Directive({
  selector: 'textarea[appAutoGrow]',
  standalone: true,
})
export class AutoGrowDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input() appAutoGrow: unknown;

  private resizeObserver?: ResizeObserver;

  constructor(private el: ElementRef<HTMLTextAreaElement>) {}

  ngAfterViewInit() {
    this.grow();
    // A textarea mounted inside a still-hidden container (e.g. a Bootstrap
    // modal, which starts at display:none and only becomes visible after
    // this directive's own AfterViewInit already ran) measures scrollHeight
    // as 0 here and never gets a follow-up ngOnChanges to correct it — watch
    // for the element actually getting real layout size and re-measure then.
    this.resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => this.grow()));
    this.resizeObserver.observe(this.el.nativeElement);
  }

  ngOnChanges() {
    queueMicrotask(() => this.grow());
  }

  @HostListener('input')
  onInput() {
    this.grow();
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
  }

  private grow() {
    const el = this.el.nativeElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
}
