import { memoryCache, sessionIdentity } from '../../../api/memoryStore.js';
import { useMemo, useState } from 'react';
import { Banknote, Download, History, Plus, Search, Trash2, Users, Wallet, AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { useCurrentTime } from '../../useCurrentTime';
import StatCard from '../../components/StatCard';
import Card from '../../components/Card';
import Avatar from '../../components/ui/Avatar';
import Modal from '../../components/ui/Modal';
import { useToast } from '../../components/ui/useToast';
import { downloadCsv } from '../../utils/csv';
import { formatDate, formatMoney, formatSom } from '../../utils/format';
import { useStudents } from '../students/useStudents';
import { loadTeachers } from '../teachers/teachersStore';
import { teacherName } from '../teachers/teachersData';
import { loadSupportTeachers } from '../support-teachers/supportStore';
import { loadUsers, loadRoles } from '../users-roles/usersStore';
import { loadGroups } from '../groups/groupsStore';
import { apiRequest, getSessionGeneration, hasBackendSession } from '../../../api/backend';
import { buildPayroll, entryMatchesEmployee } from './payroll';
import { logActivity } from '../../activity/activityStore';
import { FinTabs } from './Finance';
import { METHODS, isoDate } from './financeStore';
import { KINDS, SALARY_STATUSES, calcSalary, useSalary } from './salaryStore';
import '../students/Students.scss';
import './Finance.scss';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

const Salaries = () => {
  const toast = useToast();
  const [month, setMonth] = useState(() => isoDate(new Date()).slice(0, 7));
  const roleId = sessionIdentity.getItem('educontrol_role');
  const permissions = loadRoles().find((role) => role.id === roleId)?.permissions || [];
  const canCreate = !hasBackendSession() || roleId === 'owner' || permissions.includes('salaries.create');
  const canDelete = !hasBackendSession() || roleId === 'owner' || permissions.includes('salaries.delete');
  const { students } = useStudents();
  const sessionGeneration = getSessionGeneration();
  const backendSession = hasBackendSession();
  const [payroll, setPayroll] = useState(() => ({
    generation: sessionGeneration,
    month, attempt: 0,
    status: backendSession ? 'loading' : 'ready',
    employees: backendSession ? [] : buildPayroll({ month, payments: JSON.parse(memoryCache.getItem('edu-payments-v1') || '[]'), teachers: loadTeachers(), supportTeachers: loadSupportTeachers(), users: loadUsers(), roles: loadRoles(), students, groups: loadGroups() }),
    error: '',
  }));
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadStatus = payroll.month === month && payroll.generation === sessionGeneration && payroll.attempt === loadAttempt ? payroll.status : 'loading';
  const teachers = payroll.employees;
  useEffect(() => {
    if (!backendSession) return undefined;
    let active = true;
    const controller = new AbortController();
    const current = () => active && !controller.signal.aborted && sessionGeneration === getSessionGeneration();
    apiRequest('/payroll?month=' + month, { signal: controller.signal }).then(({ employees }) => {
      if (!current()) return;
      if (!Array.isArray(employees)) throw new Error('Ish haqi ma’lumotlari noto‘g‘ri formatda olindi. Qayta urinib ko‘ring.');
      setPayroll({ month, generation: sessionGeneration, attempt: loadAttempt, status: 'ready', employees, error: '' });
    }).catch((error) => {
      if (current()) setPayroll({ month, generation: sessionGeneration, attempt: loadAttempt, status: 'error', employees: [], error: error.message });
    });
    return () => { active = false; controller.abort(); };
  }, [loadAttempt, sessionGeneration, backendSession, month]);
  const { entries, add, remove, restore } = useSalary();
  const timestamp = useCurrentTime();
  const now = new Date(timestamp);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: isoDate(d).slice(0, 7), label: `${d.getFullYear()}, ${MONTHS[d.getMonth()]}` };
  });

  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [payFor, setPayFor] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);

  const rows = useMemo(() => loadStatus === 'ready' ? teachers.map((t) => {
    const mine = entries.filter((e) => entryMatchesEmployee(e, t) && e.month === month);
    return { t, mine, ...calcSalary(t.base, mine) };
  }) : [], [teachers, entries, month, loadStatus]);

  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const visible = rows.filter((r) => (status === 'all' || r.status === status) && teacherName(r.t).toLowerCase().includes(q.trim().toLowerCase()));
  const count = (s) => rows.filter((r) => r.status === s).length;
  const monthLabel = months.find((m) => m.value === month)?.label;
  const current = (id) => rows.find((r) => r.t.id === id);

  const submit = async (data) => {
    const t = teachers.find((x) => x.id === data.teacherId);
    await add({ ...data, teacherId: t.recordId, employeeType: t.employeeType, month });
    if (sessionGeneration !== getSessionGeneration()) return;
    logActivity({
      module: 'salaries', action: 'create', severity: data.kind === 'penalty' ? 'warning' : 'success',
      title: `${KINDS[data.kind].label}: ${teacherName(t)} — ${formatSom(data.amount)} (${monthLabel})`,
      entityId: t.id, entityName: teacherName(t), meta: { month, method: data.method, note: data.note },
    });
    toast.success(`${KINDS[data.kind].label}: ${formatSom(data.amount)} saqlandi`);
    setPayFor(null);
  };
  const del = async (e) => {
    try { await remove(e.id); }
    catch (error) { if (sessionGeneration === getSessionGeneration()) toast.error(error.message); return; }
    if (sessionGeneration !== getSessionGeneration()) return;
    const t = teachers.find((x) => entryMatchesEmployee(e, x));
    logActivity({ module: 'salaries', action: 'delete', severity: 'warning', title: `${KINDS[e.kind].label} o‘chirildi: ${teacherName(t)} — ${formatSom(e.amount)}`, entityId: e.teacherId, entityName: teacherName(t) });
    toast.info('Yozuv o‘chirildi', { action: { label: 'Qaytarish', onClick: () => restore(e).catch((error) => toast.error(error.message)) } });
  };

  return (
    <div className="students-page finance-page">
      <div className="page-head">
        <div><h1>Xodimlar ish haqi</h1><p>Ustozlar, qo‘shimcha ustozlar va xodimlarning oylik hisobi</p></div>
        <div className="page-head__actions">
          <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Oy">{months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
          <button type="button" className="btn btn--secondary" disabled={loadStatus !== 'ready' || !rows.length} onClick={() => downloadCsv(`ish-haqi-${month}.csv`, [['Ustoz', 'Hisoblangan', 'Bonus', 'Ushlanma', 'Jami', 'To‘langan', 'Qoldiq', 'Holat'], ...rows.map((r) => [teacherName(r.t), r.base, r.bonus, r.penalty, r.due, r.paid, r.left, SALARY_STATUSES[r.status].label])])}><Download size={16} /> CSV</button>
        </div>
      </div>
      <FinTabs />
      {loadStatus === 'loading' ? (
        <Card className="students-card" title="Ish haqi qaydnomasi"><p className="page__loading" role="status">Ish haqi yuklanmoqda…</p></Card>
      ) : loadStatus === 'error' ? (
        <Card className="students-card" title="Ish haqi qaydnomasi">
          <p role="alert" className="field__error">{payroll.error}</p>
          <button type="button" className="btn btn--secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Qayta urinish</button>
        </Card>
      ) : <>

      <div className="students-stats">
        <StatCard title="Jami hisoblangan" value={formatMoney(sum('due'))} icon={Wallet} tone="primary" />
        <StatCard title="To‘langan" value={formatMoney(sum('paid'))} icon={Banknote} tone="success" />
        <StatCard title="Qoldiq" value={formatMoney(sum('left'))} icon={AlertTriangle} tone="warning" />
        <StatCard title="Maosh olmaganlar" value={`${count('unpaid')} / ${rows.length}`} icon={Users} tone="danger" />
      </div>

      <Card className="students-card" title={`${monthLabel} · ish haqi qaydnomasi`}>
        <div className="toolbar">
          <div className="status-tabs">
            {[['all', 'Hammasi', rows.length], ...Object.entries(SALARY_STATUSES).map(([k, v]) => [k, v.label, count(k)])].map(([v, l, n]) => (
              <button key={v} type="button" className={status === v ? 'status-tab is-active' : 'status-tab'} onClick={() => setStatus(v)}>{l}<span className="status-tab__count">{n}</span></button>
            ))}
          </div>
          <div className="toolbar__search"><Search size={16} className="toolbar__search-icon" aria-hidden="true" /><input className="input" placeholder="Ustoz qidirish…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Ustoz</th><th>Hisob-kitob</th><th style={{ minWidth: 190 }}>To‘langan</th><th>Holat</th><th style={{ textAlign: 'right' }}>Qoldiq</th><th><span className="sr-only">Amallar</span></th></tr></thead>
            <tbody>
              {visible.map((r) => {
                const st = SALARY_STATUSES[r.status];
                return (
                  <tr key={r.t.id}>
                    <td><div className="sal-person"><Avatar firstName={r.t.firstName} lastName={r.t.lastName} /><div><strong>{teacherName(r.t)}</strong><span className="data-table__muted">{r.t.roleName} · {r.t.salaryType === 'percent' ? `${r.t.salaryValue}%` : r.t.salaryType === 'perLesson' ? 'Darsbay' : 'Oylik'}</span></div></div></td>
                    <td><div className="sal-calc">
                      <strong>{formatSom(r.due)}</strong>
                      <span className="data-table__muted">{formatMoney(r.base)}{r.bonus > 0 && <em className="sal-plus"> +{formatMoney(r.bonus)}</em>}{r.penalty > 0 && <em className="debt"> −{formatMoney(r.penalty)}</em>}</span>
                    </div></td>
                    <td>
                      <div className="sal-progress" role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label="To‘langan ulush"><span className={`sal-progress__bar sal-progress__bar--${r.status}`} style={{ width: `${r.pct}%` }} /></div>
                      <span className="sal-paid">{formatSom(r.paid)} <span className="data-table__muted">· {r.pct}%</span></span>
                    </td>
                    <td><span className={`badge badge--${st.tone}`}>{st.label}</span></td>
                    <td style={{ textAlign: 'right' }}>{r.left !== 0 ? <span className="debt">{formatSom(r.left)}</span> : <span className="data-table__muted">—</span>}</td>
                    <td><div className="fin-actions">
                      <button type="button" className="icon-btn" aria-label="Tarix" onClick={() => setHistoryFor(r.t.id)}><History size={16} /></button>
                      {canCreate && <button type="button" className="btn btn--primary btn--sm" onClick={() => setPayFor(r.t.id)}><Plus size={14} /> Amal</button>}
                    </div></td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={6} className="empty-text">Ustoz topilmadi</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {payFor && <SalaryModal key={payFor} row={current(payFor)} onClose={() => setPayFor(null)} onSubmit={(d) => submit({ ...d, teacherId: payFor })} />}
      <Modal open={Boolean(historyFor)} onClose={() => setHistoryFor(null)} title={historyFor ? teacherName(current(historyFor).t) : ''} subtitle={`${monthLabel} · amallar tarixi`} size="sm">
        {historyFor && (
          <ul className="sal-history">
            {current(historyFor).mine.sort((a, b) => b.date.localeCompare(a.date)).map((e) => (
              <li key={e.id}>
                <span className={`sal-dot sal-dot--${KINDS[e.kind].tone}`} />
                <div><strong>{KINDS[e.kind].label}</strong><span className="data-table__muted">{formatDate(e.date)} · {e.method}{e.note && ` · ${e.note}`}</span></div>
                <b className={KINDS[e.kind].sign < 0 ? 'sal-plus' : ''}>{formatSom(e.amount)}</b>
                {canDelete && <button type="button" className="icon-btn" aria-label="O‘chirish" onClick={() => del(e)}><Trash2 size={15} /></button>}
              </li>
            ))}
            {!current(historyFor).mine.length && <li className="empty-text">Bu oyda amal yo‘q</li>}
          </ul>
        )}
      </Modal>
      </>}
    </div>
  );
};

const SalaryModal = ({ row, onClose, onSubmit }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onSubmit({ kind, amount: value, method, date, note: note.trim() }); }
    catch (failure) { setError(failure.message); setSaving(false); }
  };
  const [kind, setKind] = useState('pay');
  const [amount, setAmount] = useState(String(Math.max(0, row.left) || ''));
  const [method, setMethod] = useState(METHODS[0]);
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [note, setNote] = useState('');
  const value = Number(amount) || 0;
  const pays = KINDS[kind].sign < 0;
  const over = pays && value > Math.max(0, row.left);
  const after = pays ? row.left - value : row.left + (kind === 'bonus' ? value : -value);
  const pick = (k) => { setKind(k); setAmount(KINDS[k].sign < 0 ? String(Math.max(0, row.left) || '') : ''); };
  return (
    <Modal open onClose={saving ? undefined : onClose} title={teacherName(row.t)} subtitle="Ish haqi bo‘yicha amal" size="sm"
      footer={<><button type="button" className="btn btn--secondary" onClick={onClose} disabled={saving}>Bekor qilish</button><button type="button" className="btn btn--primary" disabled={!Number.isSafeInteger(value) || value <= 0 || saving || !date} onClick={save}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button></>}>
      <div className="fin-form">
        {error && <p role="alert" className="field__error">{error}</p>}
        <div className="status-tabs" role="tablist">{Object.entries(KINDS).map(([k, v]) => <button key={k} type="button" className={kind === k ? 'status-tab is-active' : 'status-tab'} onClick={() => pick(k)}>{v.label.split(' ')[0]}</button>)}</div>
        <div className="sal-summary"><div><span>Hisoblangan</span><strong>{formatSom(row.due)}</strong></div><div><span>To‘langan</span><strong>{formatSom(row.paid)}</strong></div><div><span>Qoldiq</span><strong>{formatSom(row.left)}</strong></div></div>
        <label>Summa (so‘m)<input className="input" type="number" min="1000" step="1000" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        {over && <p className="fin-hint fin-hint--warn">Summa qoldiqdan katta — ortiqcha to‘lov bo‘ladi.</p>}
        {value > 0 && <p className="fin-hint">Amaldan keyin qoldiq: <strong>{formatSom(after)}</strong></p>}
        {pays && <label>To‘lov usuli<select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>}
        <label>Sana<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Izoh (ixtiyoriy)<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'penalty' ? 'Ushlanma sababi' : ''} /></label>
      </div>
    </Modal>
  );
};

export default Salaries;

