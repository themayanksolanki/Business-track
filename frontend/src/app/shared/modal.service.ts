import { Injectable } from '@angular/core';
import { Modal } from 'bootstrap';

/**
 * Thin wrapper around Bootstrap's Modal JS component so components can
 * open/close a `.modal` element (with its backdrop, ESC handling, and focus
 * trapping) without hand-rolling overlay/backdrop markup themselves.
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  open(element: HTMLElement, options: Partial<Modal.Options> = {}): void {
    const instance = Modal.getOrCreateInstance(element, {
      backdrop: true,
      keyboard: true,
      focus: true,
      ...options,
    });
    instance.show();
  }

  close(element: HTMLElement): void {
    Modal.getInstance(element)?.hide();
  }

  dispose(element: HTMLElement): void {
    Modal.getInstance(element)?.dispose();
  }
}
