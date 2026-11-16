import { LoaderCircle, TriangleAlert } from 'lucide-react';
import './RecoveryScreen.scss';

export default function AsyncState({ title, message, onRetry, fullPage = false }) {
  const Icon = onRetry ? TriangleAlert : LoaderCircle;
  return <section className={`async-state${fullPage ? ' async-state--full' : ''}`} role={onRetry ? 'alert' : 'status'} aria-live={onRetry ? 'assertive' : 'polite'}>
    <div className="recovery-screen__card">
      <Icon size={28} className={onRetry ? '' : 'async-state__spinner'} aria-hidden="true" />
      <h1>{title}</h1>
      {message && <p>{message}</p>}
      {onRetry && <div><button type="button" className="btn btn--primary" onClick={onRetry}>Qayta urinish</button></div>}
    </div>
  </section>;
}
