import { paymentLedger } from './paymentLedger.js';
import { formatSom } from '../../utils/format';
import { useCurrentTime } from '../../useCurrentTime';
import './PaymentLedger.scss';

export default function PaymentLedger({ student, payments }) {
  const now = useCurrentTime();
  const ledger = paymentLedger(student, payments, new Date(now));
  if (!ledger.rows.length) return <p className="empty-text">Oylar hisobini ko‘rish uchun talabaning qo‘shilgan sanasini kiriting.</p>;
  return <section className="payment-ledger" aria-label="Oylar bo‘yicha to‘lovlar">
    <h4>Oylar bo‘yicha to‘lov jamlanmasi</h4>
    <div className="payment-ledger__summary"><span>Jami to‘langan <strong>{formatSom(ledger.paid)}</strong></span><span>Qarzdor oylar <strong>{ledger.rows.filter((r) => r.debt > 0).length} oy</strong></span><span>Hisoblangan qarz <strong>{formatSom(ledger.debt)}</strong></span>{ledger.credit > 0 && <span>Oldindan to‘lov <strong>{formatSom(ledger.credit)}</strong></span>}</div>
    <p className="payment-ledger__note">To‘lovlar eng eski oydan boshlab jamlanadi. Hisob qo‘shilgan sana, birinchi oy summasi va amaldagi oylik narx asosida tuzilgan.</p>
    <div className="payment-ledger__scroll"><table><thead><tr><th>Oy</th><th>Hisoblangan</th><th>To‘langan</th><th>Qoldiq</th><th>Holat</th></tr></thead><tbody>{ledger.rows.map((r) => <tr key={r.month}><td>{r.month}</td><td>{formatSom(r.charge)}</td><td>{formatSom(r.paid)}</td><td>{formatSom(r.debt)}</td><td><span className={`badge badge--${!r.debt ? 'success' : r.paid ? 'warning' : 'danger'}`}>{!r.debt ? 'To‘liq to‘langan' : r.paid ? 'Qisman' : 'To‘lanmagan'}</span></td></tr>)}</tbody></table></div>
  </section>;
}
