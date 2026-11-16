import { sessionIdentity } from '../api/memoryStore.js';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import Card from '../admin/components/Card';
import { apiRequest } from '../api/backend';
import { loadSettings } from '../admin/pages/settings/settingsStore';
import './AccountSecurity.scss';

export default function AccountSecurity() {
  const navigate = useNavigate();
  const userId = sessionIdentity.getItem('educontrol_user_id');
  const login = sessionIdentity.getItem('educontrol_username') || '';
  const passwordMinimum = Number(loadSettings()?.security?.passwordMinLength) || 8;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const back = () => navigate(sessionIdentity.getItem('educontrol_role') === 'teacher' ? '/teacher' : sessionIdentity.getItem('educontrol_role') === 'reception' ? '/reception' : '/admin');

  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    setSaved(false);
    if (!userId) return setError('Bu hisob xodimlar ro‘yxatiga ulanmagan. Administrator foydalanuvchi hisobini sozlashi kerak.');
    if ([...next].length < passwordMinimum) return setError(`Yangi parol kamida ${passwordMinimum} ta belgidan iborat bo‘lsin.`);
    if (next.length > 256) return setError('Parol 256 belgidan oshmasligi kerak.');
    if (next !== confirm) return setError('Yangi parollar mos kelmadi.');
    submitting.current = true;
    setSaving(true);
    try {
      await apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setCurrent(''); setNext(''); setConfirm(''); setSaved(true);
    } catch (changeError) { setError(changeError.message); }
    finally { submitting.current = false; setSaving(false); }
  };

  return <main className="page account-security">
    <header className="page-head"><div><h1>Hisob xavfsizligi</h1><p>{login} · login va parol sozlamalari</p></div><button type="button" className="btn btn--secondary" onClick={back}><ArrowLeft size={16}/> Orqaga</button></header>
    <Card title="Parolni o‘zgartirish" subtitle={`Yangi parol kamida ${passwordMinimum} ta belgidan iborat bo‘lishi kerak.`}>
      <form className="student-form" onSubmit={submit}>
        <label className="field"><span className="field__label">Joriy parol</span><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="field"><span className="field__label">Yangi parol</span><input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <label className="field"><span className="field__label">Yangi parolni tasdiqlang</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        {error && <p className="field__error" role="alert">{error}</p>}
        {saved && <p className="field__hint" role="status">Parol muvaffaqiyatli o‘zgartirildi.</p>}
        <button type="submit" className="btn btn--primary" disabled={saving}><KeyRound size={16}/>{saving ? 'Saqlanmoqda…' : 'Parolni saqlash'}</button>
      </form>
    </Card>
    <p className="account-security__hint"><ShieldCheck size={16}/> Parol xavfsiz xesh ko‘rinishida saqlanadi.</p>
  </main>;
}
