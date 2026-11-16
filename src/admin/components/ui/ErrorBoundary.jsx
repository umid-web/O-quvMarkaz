import { Component } from 'react';
import './RecoveryScreen.scss';

export function RecoveryScreen({ onRetry, title = 'Sahifani ko‘rsatib bo‘lmadi' }) {
  return <main className="recovery-screen" role="alert" aria-labelledby="recovery-title">
    <section className="recovery-screen__card">
      <h1 id="recovery-title">{title}</h1>
      <p>Kutilmagan xatolik yuz berdi. Avval qayta urinib ko‘ring. Muammo takrorlansa, sahifani qayta oching yoki administratorga murojaat qiling.</p>
      <p>Saqlanmagan qoralamalar sahifa xotirasida bo‘lishi mumkin. Qayta yuklashdan oldin brauzer ogohlantirishini tekshiring.</p>
      <div className="recovery-screen__actions">
        <button type="button" className="btn btn--primary" onClick={onRetry}>Qayta urinish</button>
        <button type="button" className="btn btn--secondary" onClick={() => window.location.reload()}>Sahifani qayta yuklash</button>
      </div>
    </section>
  </main>;
}

export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() {
    // No exception text, component props, or private state is persisted or sent.
    window.dispatchEvent(new Event('educontrol:render-error'));
  }

  retry = () => { this.setState({ failed: false }); };

  render() {
    if (this.state.failed) return <RecoveryScreen onRetry={this.retry} />;
    return this.props.children;
  }
}
