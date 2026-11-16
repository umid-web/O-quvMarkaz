import { useEffect, useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import { createDialogAction } from './dialogAction';

/** Xavfli amallar uchun tasdiqlash oynasi. */
const ConfirmDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Tasdiqlash',
  cancelLabel = 'Bekor qilish',
  tone = 'danger',
  onConfirm,
  onCancel,
}) => {
  const [actionState, setActionState] = useState({ pending: false, error: '' });
  const [action] = useState(() => createDialogAction(setActionState));
  const descriptionId = useId();
  const errorId = useId();

  useEffect(() => {
    action.reset();
    return () => action.invalidate();
  }, [action, open]);

  const cancel = () => { if (!action.pending) onCancel?.(); };

  return (
    <Modal
      open={open}
      onClose={cancel}
      busy={actionState.pending}
      describedBy={`${descriptionId}${actionState.error ? ` ${errorId}` : ''}`}
      size="sm"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem' }}>
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 34,
              height: 34,
              borderRadius: 10,
              background: `var(--${tone}-soft)`,
              color: `var(--${tone})`,
            }}
          >
            <AlertTriangle size={18} />
          </span>
          {title}
        </span>
      }
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={cancel} disabled={actionState.pending} data-autofocus>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn btn--${tone === 'danger' ? 'danger' : 'primary'}`}
            onClick={() => action.run(onConfirm)}
            disabled={actionState.pending}
          >
            {actionState.pending ? 'Bajarilmoqda…' : confirmLabel}
          </button>
        </>
      }
    >
      <p id={descriptionId} style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>{message}</p>
      {actionState.error && <p id={errorId} className="field__error" role="alert">{actionState.error}</p>}
    </Modal>
  );
};

export default ConfirmDialog;
