import { Directive, ElementRef, HostListener, AfterViewInit, Input, OnChanges } from '@angular/core';

// Resizes a textarea to fit its content, with no drag handle and no scrollbar —
// bound to a value input (not just the native `input` event) so programmatic
// changes (e.g. reactive-form patchValue while the element stays mounted) also
// trigger a re-measure, not just user keystrokes.
@Directive({
  selector: 'textarea[appAutoGrow]',
  standalone: true,
})
export class AutoGrowDirective implements AfterViewInit, OnChanges {
  @Input() appAutoGrow: unknown;

  constructor(private el: ElementRef<HTMLTextAreaElement>) {}

  ngAfterViewInit() {
    this.grow();
  }

  ngOnChanges() {
    queueMicrotask(() => this.grow());
  }

  @HostListener('input')
  onInput() {
    this.grow();
  }

  private grow() {
    const el = this.el.nativeElement;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }
}
