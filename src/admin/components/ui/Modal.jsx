import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './Modal.scss';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Ichma-ich modallar uchun (masalan, drawer ustida tasdiqlash oynasi) scroll qulfi hisoblagichi
let scrollLocks = 0;
let previousOverflow = '';
let previousOverflowPriority = '';
const modalPanels = [];
const lockScroll = () => {
  if (scrollLocks++ === 0) {
    previousOverflow = document.body.style.getPropertyValue('overflow');
    previousOverflowPriority = document.body.style.getPropertyPriority('overflow');
    document.body.style.setProperty('overflow', 'hidden');
  }
};
const unlockScroll = () => {
  if (scrollLocks > 0 && --scrollLocks === 0) {
    if (previousOverflow) document.body.style.setProperty('overflow', previousOverflow, previousOverflowPriority);
    else document.body.style.removeProperty('overflow');
  }
};

/**
 * Modal oyna / yon panel (drawer).
 * - variant: 'dialog' (markazda) | 'drawer' (o‘ng tomondan)
 * - size: 'sm' | 'md' | 'lg'
 * Esc bilan yopiladi, fokus oyna ichida qoladi va yopilganda avvalgi elementga qaytadi.
 */
const Modal = ({
  open,
  onClose,
  title,
  subtitle,
  footer,
  size = 'md',
  variant = 'dialog',
  busy = false,
  closeDisabled = false,
  describedBy,
  children,
}) => {
  const panelRef = useRef(null);
  const titleId = useId();
  const subtitleId = `${titleId}-subtitle`;
  const closeRef = useRef({ onClose, disabled: busy || closeDisabled });

  useEffect(() => {
    closeRef.current = { onClose, disabled: busy || closeDisabled };
  });

  const requestClose = () => {
    if (!busy && !closeDisabled) onClose?.();
  };

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const panel = panelRef.current;
    lockScroll();
    modalPanels.push(panel);

    const items = () => [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null && !el.closest('[inert]'));
    const target = items().find((el) => el.hasAttribute('data-autofocus')) ||
      items().find((el) => el.closest('.modal__body')) || items()[0] || panel;
    target.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!closeRef.current.disabled) closeRef.current.onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = items();
      if (!focusable.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', onKeyDown);

    return () => {
      panel.removeEventListener('keydown', onKeyDown);
      const wasTop = modalPanels.at(-1) === panel;
      const index = modalPanels.indexOf(panel);
      if (index !== -1) modalPanels.splice(index, 1);
      unlockScroll();
      if (wasTop) {
        const remaining = modalPanels.at(-1);
        if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus?.();
        else remaining?.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !busy || modalPanels.at(-1) !== panel) return;
    // Disabling the clicked button can leave keyboard focus on the page body.
    const focused = document.activeElement;
    if (!panel.contains(focused) || focused?.disabled) panel.focus();
  }, [open, busy]);

  if (!open) return null;

  return createPortal(
    <div className={`modal modal--${variant}`}>
      <div className="modal__backdrop" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={`modal__panel modal__panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={[subtitle && subtitleId, describedBy].filter(Boolean).join(' ') || undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header className="modal__header">
          <div className="modal__heading">
            <h2 id={titleId} className="modal__title">{title}</h2>
            {subtitle && <p id={subtitleId} className="modal__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="icon-btn modal__close" onClick={requestClose} disabled={busy || closeDisabled} aria-label="Yopish"><X size={17}/></button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
