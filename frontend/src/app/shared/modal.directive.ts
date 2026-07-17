import { Directive, ElementRef, EventEmitter, Input, OnChanges, AfterViewInit, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { Modal } from 'bootstrap';
import { ModalService } from './modal.service';

/**
 * Drives a Bootstrap `.modal` element from a plain boolean input, the same
 * way these components previously toggled a hand-rolled overlay with `@if`.
 * Backdrop clicks, ESC, and any `data-bs-dismiss="modal"` button all funnel
 * through Bootstrap's own `hidden.bs.modal` event, which this directive
 * re-emits as `(appModalClosed)` so the bound `open` state stays in sync
 * however the modal was dismissed.
 *
 * Usage: <div class="modal" [appModal]="open" [appModalOptions]="{backdrop:'static'}" (appModalClosed)="open=false">
 */
@Directive({
  selector: '[appModal]',
  standalone: true,
})
export class ModalDirective implements OnChanges, AfterViewInit, OnDestroy {
  @Input('appModal') open = false;
  @Input() appModalOptions: Partial<Modal.Options> = {};
  @Output() appModalClosed = new EventEmitter<void>();

  private viewReady = false;
  private readonly onHidden = () => this.appModalClosed.emit();

  constructor(
    private readonly el: ElementRef<HTMLElement>,
    private readonly modalService: ModalService,
  ) {}

  ngAfterViewInit(): void {
    this.el.nativeElement.addEventListener('hidden.bs.modal', this.onHidden);
    this.viewReady = true;
    this.sync();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.viewReady) {
      this.sync();
    }
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('hidden.bs.modal', this.onHidden);
    this.modalService.dispose(this.el.nativeElement);
  }

  private sync(): void {
    if (this.open) {
      this.modalService.open(this.el.nativeElement, this.appModalOptions);
    } else {
      this.modalService.close(this.el.nativeElement);
    }
  }
}
